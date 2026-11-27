import { and, eq, inArray, isNull } from "drizzle-orm";
import { draftApplication, draftFollowUp, type OutreachDraft } from "@/lib/ai/tasks";
import { researchCompany } from "@/lib/apply/research";
import type { Profile } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import type { Job } from "@/lib/db/schema";
import { findReplies } from "@/lib/mail/imap";
import type { AppSettings } from "@/lib/settings";
import { daysBetween, errorMessage, uid } from "@/lib/util";
import type { Log } from "./find";

type Db = Awaited<ReturnType<typeof getDb>>;
type Contact = typeof schema.contacts.$inferSelect;
type OutboxRow = typeof schema.outbox.$inferSelect;

/** Outbox states that have not gone out, so a rewritten letter may replace them. */
const UNSENT = ["queued", "approved", "failed"];
/** Job states where a follow-up would be out of place. */
const NO_FOLLOW_UP = ["Rejected", "Skipped", "Offer", "Interview", "Replied"];

/** Lower is better: verified person, then a careers inbox, then any address from the site, then the rest. */
function contactRank(c: Contact): number {
  if (c.emailStatus === "verified") return 0;
  if (/careers|hiring/i.test(c.title ?? "")) return 1;
  return c.emailStatus === "site" ? 2 : 3;
}

/** Best person to email at a company: verified person, then hiring inbox, then any. */
export async function bestContact(cId: string | null) {
  if (!cId) return null;
  const db = await getDb();
  const all = await db.select().from(schema.contacts).where(eq(schema.contacts.companyId, cId));
  const usable = all.filter((c) => c.email && !c.optedOut && c.status !== "Do not contact");
  return usable.sort((a, b) => contactRank(a) - contactRank(b))[0] ?? null;
}

/**
 * Reads up on the company, then writes the cover letter (also the email) and
 * CV selection for one job. Site text is cached on the company for a month.
 */
export async function writeApplication(
  job: Job,
  profile: Profile,
  contact: { name?: string | null; title?: string | null } | null,
): Promise<OutreachDraft> {
  const db = await getDb();
  const [company] = job.companyId ? await db.select().from(schema.companies).where(eq(schema.companies.id, job.companyId)) : [];
  const research = await researchCompany({ company: job.company, link: job.link, description: job.description }, company ?? null);
  if (company && research.fresh) {
    await db
      .update(schema.companies)
      .set({ research: research.fresh, researchedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.companies.id, company.id));
  }
  const forDraft = {
    company: job.company,
    role: job.role,
    location: job.location,
    mode: job.mode,
    link: job.link,
    description: job.description ?? job.notes,
    research: research.text,
  };
  return draftApplication(profile, forDraft, contact);
}

/** Keeps unsent Outbox emails in step with a rewritten letter, while nothing has gone out. */
async function refreshUnsent(db: Db, job: Job, draft: OutreachDraft, existing: Pick<OutboxRow, "id" | "status" | "followUpOf">[]) {
  const unsent = existing.filter((o) => !o.followUpOf && UNSENT.includes(o.status));
  if (job.cover || unsent.length !== existing.length) return;
  await Promise.all(
    unsent.map((o) =>
      db
        .update(schema.outbox)
        .set({ subject: draft.subject, body: draft.body, cvVariant: draft.cvVariant, updatedAt: new Date() })
        .where(eq(schema.outbox.id, o.id)),
    ),
  );
}

/**
 * Writes the cover letter and CV selection for one job. Puts it in the Outbox
 * when there is someone to send it to; otherwise the draft stays on the job
 * for a portal application. An unsent Outbox email is replaced by a rewrite.
 * Never sends: the user reviews and clicks Send.
 */
export async function draftForJob(job: Job, profile: Profile): Promise<{ queued: boolean }> {
  const db = await getDb();
  const contact = await bestContact(job.companyId);
  const draft = await writeApplication(job, profile, contact);

  await db
    .update(schema.jobs)
    .set({
      // A cover letter the user already has is never overwritten.
      cover: job.cover || draft.body,
      // The pitch describes the letter on the job, so it is replaced only with it.
      pitch: job.cover ? job.pitch : draft.pitch,
      cvVariant: draft.cvVariant,
      status: job.status === "Found" ? "Drafted" : job.status,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, job.id));

  if (!contact?.email) return { queued: false };
  const existing = await db
    .select({ id: schema.outbox.id, status: schema.outbox.status, followUpOf: schema.outbox.followUpOf })
    .from(schema.outbox)
    .where(eq(schema.outbox.jobId, job.id));
  if (existing.length) {
    await refreshUnsent(db, job, draft, existing);
    return { queued: false };
  }

  await db.insert(schema.outbox).values({
    id: uid(),
    jobId: job.id,
    contactId: contact.id,
    companyId: job.companyId,
    to: contact.email,
    subject: draft.subject,
    body: draft.body,
    cvVariant: draft.cvVariant,
  });
  return { queued: true };
}

export async function draftStrongJobs(profile: Profile, limit: number, log: Log): Promise<number> {
  const db = await getDb();
  const candidates = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.fit, "Strong"), inArray(schema.jobs.status, ["Found", "Drafted"]), isNull(schema.jobs.cvVariant)));
  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  let drafted = 0;
  let queued = 0;
  for (const job of candidates.slice(0, limit)) {
    try {
      // CLI providers run one process per call and API providers rate-limit, so drafts are written one at a time.
      // eslint-disable-next-line no-await-in-loop -- one AI draft at a time on purpose
      const r = await draftForJob(job, profile);
      drafted++;
      if (r.queued) queued++;
    } catch (err) {
      log(`Draft for ${job.company}: ${errorMessage(err)}`);
    }
  }
  if (drafted) log(`Wrote ${drafted} applications (${queued} waiting in Outbox)`);
  return drafted;
}

// ---------- replies and follow-ups ----------

/** Marks the thread replied, and its job and contact with it. */
async function markReplied(db: Db, item: OutboxRow) {
  const now = new Date();
  await db.update(schema.outbox).set({ repliedAt: now, updatedAt: now }).where(eq(schema.outbox.id, item.id));
  if (item.jobId) {
    await db
      .update(schema.jobs)
      .set({ status: "Replied", followUp: null, updatedAt: now })
      .where(and(eq(schema.jobs.id, item.jobId), eq(schema.jobs.status, "Applied")));
  }
  if (item.contactId) {
    await db.update(schema.contacts).set({ status: "Replied", nextFollowUp: null, updatedAt: now }).where(eq(schema.contacts.id, item.contactId));
  }
}

export async function checkReplies(log: Log): Promise<number> {
  const db = await getDb();
  const waiting = await db.select().from(schema.outbox).where(and(eq(schema.outbox.status, "sent"), isNull(schema.outbox.repliedAt)));
  if (!waiting.length) return 0;

  let replied: Set<string>;
  try {
    replied = await findReplies(waiting.filter((w) => w.sentAt).map((w) => ({ email: w.to, since: w.sentAt! })));
  } catch (err) {
    log(`Reply check: ${errorMessage(err)}`);
    return 0;
  }

  const answered = waiting.filter((item) => replied.has(item.to.toLowerCase()));
  await Promise.all(answered.map((item) => markReplied(db, item)));
  if (answered.length) log(`${answered.length} new replies found in Gmail`);
  return answered.length;
}

/** Sent first emails with no reply and no follow-up yet, at least `followUpDays` old. */
function dueForFollowUp(all: OutboxRow[], followUpDays: number): OutboxRow[] {
  const hasFollowUp = new Set(all.map((o) => o.followUpOf).filter(Boolean));
  return all.filter(
    (o) =>
      o.status === "sent" && !o.followUpOf && !o.repliedAt && o.sentAt && !hasFollowUp.has(o.id) && daysBetween(o.sentAt.toISOString()) >= followUpDays,
  );
}

/** Drafts one follow-up into the Outbox, in the same thread. The user sends it. */
async function draftOneFollowUp(db: Db, profile: Profile, o: OutboxRow, job: Job | undefined) {
  const f = await draftFollowUp(profile, {
    subject: o.subject,
    body: o.body,
    company: job?.company ?? "the company",
    role: job?.role ?? "the role",
  });
  await db.insert(schema.outbox).values({
    id: uid(),
    jobId: o.jobId,
    contactId: o.contactId,
    companyId: o.companyId,
    to: o.to,
    subject: f.subject,
    body: f.body,
    followUpOf: o.id,
  });
}

export async function draftFollowUps(profile: Profile, settings: AppSettings, log: Log, limit = 5): Promise<number> {
  const db = await getDb();
  const due = dueForFollowUp(await db.select().from(schema.outbox), settings.outreach.followUpDays).slice(0, limit);
  // One query for all their jobs, not one per email.
  const jobIds = due.map((o) => o.jobId).filter((id): id is string => !!id);
  const jobs = jobIds.length ? await db.select().from(schema.jobs).where(inArray(schema.jobs.id, jobIds)) : [];
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  let drafted = 0;
  for (const o of due) {
    const job = o.jobId ? jobById.get(o.jobId) : undefined;
    if (job && NO_FOLLOW_UP.includes(job.status)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop -- one AI draft at a time on purpose (see draftStrongJobs)
      await draftOneFollowUp(db, profile, o, job);
      drafted++;
    } catch (err) {
      log(`Follow-up for ${o.to}: ${errorMessage(err)}`);
    }
  }
  if (drafted) log(`Wrote ${drafted} follow-ups`);
  return drafted;
}
