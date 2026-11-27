import { desc, eq } from "drizzle-orm";
import { HttpError, route } from "@/lib/api";
import { writeApplication } from "@/lib/pipeline/steps";
import { profileIsReady } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import { sentTodayCount } from "@/lib/pipeline/send";
import { getProfile, getSettings } from "@/lib/settings";
import { uid } from "@/lib/util";

export const GET = route(async () => {
  const db = await getDb();
  const [items, jobs, contacts, settings, sentToday] = await Promise.all([
    db.select().from(schema.outbox).orderBy(desc(schema.outbox.createdAt)),
    db.select().from(schema.jobs),
    db.select().from(schema.contacts),
    getSettings(),
    sentTodayCount(),
  ]);
  const jobBy = new Map(jobs.map((j) => [j.id, j]));
  const contactBy = new Map(contacts.map((c) => [c.id, c]));
  return {
    sentToday,
    dailyCap: settings.caps.dailySend,
    items: items.map((o) => {
      const job = o.jobId ? jobBy.get(o.jobId) : undefined;
      const contact = o.contactId ? contactBy.get(o.contactId) : undefined;
      return {
        ...o,
        job: job && { id: job.id, company: job.company, role: job.role, link: job.link, fit: job.fit },
        contact: contact && {
          id: contact.id,
          name: contact.name,
          title: contact.title,
          emailStatus: contact.emailStatus,
          optedOut: contact.optedOut,
        },
      };
    }),
  };
});

type Db = Awaited<ReturnType<typeof getDb>>;
type Job = typeof schema.jobs.$inferSelect;
type Draft = Awaited<ReturnType<typeof writeApplication>>;

const CLOSED = ["Rejected", "Skipped"];

/** The job asked for, else the company's best-scoring open job. */
function pickJob(companyJobs: Job[], jobId: string | undefined): Job | undefined {
  return (
    companyJobs.find((j) => j.id === jobId) ??
    companyJobs.filter((j) => !CLOSED.includes(j.status)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
  );
}

/** A job without its own draft keeps this one, without overwriting a letter you already have. */
async function keepDraftOnJob(db: Db, job: Job, draft: Draft) {
  if (job.cvVariant) return;
  await db
    .update(schema.jobs)
    .set({
      cvVariant: draft.cvVariant,
      cover: job.cover || draft.body,
      pitch: job.cover ? job.pitch : draft.pitch,
      status: job.status === "Found" ? "Drafted" : job.status,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, job.id));
}

async function emailableContact(db: Db, contactId: string) {
  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
  if (!contact) throw new HttpError(404, "Contact not found.");
  if (!contact.email) throw new HttpError(400, "This contact has no email address.");
  if (contact.optedOut) throw new HttpError(400, "This contact asked not to be contacted.");
  return { ...contact, email: contact.email };
}

/** Writes a new email to a contact, about one of the company's jobs when there is one. Nothing is sent. */
export const POST = route(async (req: Request) => {
  const { contactId, jobId } = (await req.json()) as { contactId: string; jobId?: string };
  const db = await getDb();
  const contact = await emailableContact(db, contactId);
  const profile = await getProfile();
  if (!profileIsReady(profile)) throw new HttpError(400, "Add your CV in Settings first.");

  const companyJobs = contact.companyId ? await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, contact.companyId)) : [];
  const job = pickJob(companyJobs, jobId);
  if (!job) throw new HttpError(400, "Add a job for this company first, so the email has a role to apply for.");

  const draft = await writeApplication(job, profile, contact);
  const id = uid();
  await db.insert(schema.outbox).values({
    id,
    jobId: job.id,
    contactId: contact.id,
    companyId: contact.companyId,
    to: contact.email,
    subject: draft.subject,
    body: draft.body,
    cvVariant: draft.cvVariant,
  });
  await keepDraftOnJob(db, job, draft);
  return { id };
});
