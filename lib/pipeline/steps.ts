import { and, eq, inArray, isNull } from "drizzle-orm";
import { draftApplication, draftFollowUp, scoreJobs } from "@/lib/ai/tasks";
import { profileIsReady, type Profile } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import type { Company, Job } from "@/lib/db/schema";
import { findReplies } from "@/lib/mail/imap";
import { describeMinPay } from "@/lib/pay";
import type { AppSettings } from "@/lib/settings";
import { apolloCompany, apolloPeople, hasApollo } from "@/lib/sources/apollo";
import { BudgetError } from "@/lib/sources/apify";
import { findWebsites, rankEmails, scrapeSites } from "@/lib/sources/contacts";
import { searchGoogle, searchIndeed, searchLinkedIn } from "@/lib/sources/jobs";
import type { RawJob, SiteContacts } from "@/lib/sources/types";
import { chunk, daysBetween, domainOf, errorMessage, slug, today, uid } from "@/lib/util";
import { companyId, dedupeJobs, jobId } from "./dedupe";
import { rejectReason, type JobFilter } from "./filter";

export type Log = (line: string) => void;

// ---------- find ----------

export async function findJobs(settings: AppSettings, log: Log, freshOnly: boolean): Promise<RawJob[]> {
  const { search } = settings;
  const postedWithinDays = freshOnly ? 1 : search.postedWithinDays;
  const found: RawJob[] = [];
  let budgetHit = false;

  const attempt = async (label: string, fn: () => Promise<RawJob[]>) => {
    if (budgetHit) return;
    try {
      const jobs = await fn();
      found.push(...jobs);
      log(`${label}: ${jobs.length} jobs`);
    } catch (err) {
      if (err instanceof BudgetError) budgetHit = true;
      log(`${label}: ${errorMessage(err)}`);
    }
  };

  for (const location of search.locations) {
    for (const title of search.titles) {
      const input = {
        title,
        location,
        postedWithinDays,
        limit: search.maxPerSearch,
        excludeTitleWords: search.excludeTitleWords,
      };
      if (search.sources.linkedin && location.linkedin) {
        await attempt(`LinkedIn "${title}" in ${location.label}`, () => searchLinkedIn(input));
      }
      if (search.sources.indeed && location.indeedCountry) {
        await attempt(`Indeed "${title}" in ${location.label}`, () => searchIndeed(input));
      }
    }
  }

  if (search.sources.google && search.titles.length) {
    const remote = search.locations.find((l) => l.remote);
    await attempt("Google career boards", () =>
      searchGoogle(search.titles, {
        remoteOnly: !!remote,
        postedWithinDays,
        tier: remote?.label ?? search.locations[0]?.label ?? "",
        excludeTitleWords: search.excludeTitleWords,
      }),
    );
  }
  return found;
}

// ---------- store ----------

export async function upsertCompany(
  name: string,
  info: RawJob["company_"] = {},
): Promise<string> {
  const db = await getDb();
  const id = companyId(name);
  const [existing] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
  const clean = Object.fromEntries(
    Object.entries(info).filter(([, v]) => typeof v === "string" && v.trim()),
  ) as Partial<Company>;
  if (!existing) {
    await db.insert(schema.companies).values({ id, name, ...clean });
  } else {
    // Only fill gaps; never overwrite what the user or an earlier lookup saved.
    const patch = Object.fromEntries(
      Object.entries(clean).filter(([k]) => !existing[k as keyof Company]),
    );
    if (Object.keys(patch).length) {
      await db
        .update(schema.companies)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.companies.id, id));
    }
  }
  return id;
}

export async function storeJobs(raw: RawJob[], filter: JobFilter, log: Log): Promise<number> {
  const db = await getDb();
  const existing = await db
    .select({
      id: schema.jobs.id,
      company: schema.jobs.company,
      role: schema.jobs.role,
      link: schema.jobs.link,
      source: schema.jobs.source,
      sourceId: schema.jobs.sourceId,
    })
    .from(schema.jobs);
  const unique = dedupeJobs(raw, existing);
  const fresh = unique.filter((j) => !rejectReason(j, filter));
  const taken = new Set(existing.map((j) => j.id));

  for (const j of fresh) {
    const cId = await upsertCompany(j.company, j.company_);
    await db.insert(schema.jobs).values({
      id: jobId(j.company, j.role, taken),
      company: j.company,
      role: j.role,
      link: j.link,
      status: "Found",
      source: j.source,
      sourceId: j.sourceId,
      pay: j.pay || null,
      tier: j.tier || null,
      mode: j.mode || null,
      location: j.location || null,
      description: j.description || null,
      found: today(),
      companyId: cId,
    });
    if (j.recruiter?.name) {
      const contactId = slug(`${j.recruiter.name} ${j.company}`, "contact");
      await db
        .insert(schema.contacts)
        .values({
          id: contactId,
          companyId: cId,
          company: j.company,
          name: j.recruiter.name,
          title: "Job poster",
          linkedin: j.recruiter.linkedin || null,
          source: "LinkedIn",
        })
        .onConflictDoNothing();
    }
  }
  log(`Saved ${fresh.length} new jobs (${raw.length - unique.length} duplicates skipped)`);
  if (unique.length > fresh.length) {
    log(`Filtered out ${unique.length - fresh.length} jobs (pay or location)`);
  }
  return fresh.length;
}

// ---------- score ----------

export async function scoreNewJobs(
  profile: Profile,
  settings: AppSettings,
  log: Log,
  limit = 60,
): Promise<number> {
  const db = await getDb();
  const pending = await db
    .select()
    .from(schema.jobs)
    .where(and(isNull(schema.jobs.fit), eq(schema.jobs.status, "Found")))
    .limit(limit);
  if (!pending.length) return 0;

  let scored = 0;
  for (const batch of chunk(pending, 10)) {
    try {
      const results = await scoreJobs(
        profile,
        batch.map((j) => ({
          id: j.id,
          company: j.company,
          role: j.role,
          location: j.location,
          pay: j.pay,
          description: j.description ?? j.notes,
        })),
        {
          titles: settings.search.titles,
          locations: settings.search.locations.map((l) => l.label),
          minPay: describeMinPay(settings.search.minPay),
          homeCity: settings.search.homeCity.trim(),
        },
      );
      for (const r of results) {
        const job = batch.find((j) => j.id === r.id);
        if (!job) continue;
        await db
          .update(schema.jobs)
          .set({
            fit: r.fit,
            score: r.score,
            flags: [...new Set([...(job.flags ?? []), ...r.flags])],
            notes: job.notes || r.reason,
            status: r.fit === "Skip" ? "Skipped" : job.status,
            updatedAt: new Date(),
          })
          .where(eq(schema.jobs.id, r.id));
        scored++;
      }
    } catch (err) {
      log(`Scoring failed for a batch: ${errorMessage(err)}`);
      break;
    }
  }
  log(`Scored ${scored} jobs`);
  return scored;
}

// ---------- enrich ----------

async function saveSiteContacts(company: Company, site: SiteContacts | undefined) {
  const db = await getDb();
  const domain = domainOf(company.website);
  const ranked = rankEmails(site?.emails ?? [], domain);
  const inbox = ranked.find((e) => e.kind === "hiring") ?? ranked.find((e) => e.kind === "generic");
  const people = ranked.filter((e) => e.kind === "person").slice(0, 2);
  const phone = site?.phones?.[0] ?? null;

  if (inbox) {
    await db
      .insert(schema.contacts)
      .values({
        id: slug(`hiring ${company.name}`, "contact"),
        companyId: company.id,
        company: company.name,
        name: `${company.name} hiring team`,
        title: inbox.kind === "hiring" ? "Careers inbox" : "General inbox",
        email: inbox.email,
        emailStatus: "site",
        phone,
        source: "Website",
      })
      .onConflictDoNothing();
  }
  for (const p of people) {
    const local = p.email.split("@")[0];
    const name = local
      .split(/[._-]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    await db
      .insert(schema.contacts)
      .values({
        id: slug(`${local} ${company.name}`, "contact"),
        companyId: company.id,
        company: company.name,
        name,
        email: p.email,
        emailStatus: "site",
        source: "Website",
        notes: "Name taken from the email address; check it before writing.",
      })
      .onConflictDoNothing();
  }
  return { emails: ranked.length, phone };
}

async function saveApollo(company: Company, log: Log) {
  const domain = domainOf(company.website);
  if (!domain || !(await hasApollo())) return;
  const db = await getDb();
  try {
    const info = await apolloCompany(domain);
    if (info) {
      await db
        .update(schema.companies)
        .set({
          size: company.size || info.size || null,
          industry: company.industry || info.industry || null,
          about: company.about || info.about || null,
          address: company.address || info.address || null,
          phone: company.phone || info.phone || null,
          linkedin: company.linkedin || info.linkedin || null,
          updatedAt: new Date(),
        })
        .where(eq(schema.companies.id, company.id));
    }
    for (const p of await apolloPeople(domain)) {
      await db
        .insert(schema.contacts)
        .values({
          id: slug(`${p.name} ${company.name}`, "contact"),
          companyId: company.id,
          company: company.name,
          name: p.name,
          title: p.title || null,
          email: p.email || null,
          emailStatus: p.email ? "verified" : null,
          phone: p.phone || null,
          linkedin: p.linkedin || null,
          source: "Apollo",
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    log(`Apollo lookup for ${company.name}: ${errorMessage(err)}`);
  }
}

/** Looks up website, public emails, phone and people for the given companies. */
export async function enrichCompanies(ids: string[], log: Log): Promise<number> {
  if (!ids.length) return 0;
  const db = await getDb();
  let companies = await db.select().from(schema.companies).where(inArray(schema.companies.id, ids));

  const missingSite = companies.filter((c) => !c.website);
  if (missingSite.length) {
    try {
      const sites = await findWebsites(missingSite.map((c) => c.name));
      for (const c of missingSite) {
        const website = sites.get(c.name);
        if (website) {
          await db
            .update(schema.companies)
            .set({ website, updatedAt: new Date() })
            .where(eq(schema.companies.id, c.id));
        }
      }
      companies = await db.select().from(schema.companies).where(inArray(schema.companies.id, ids));
    } catch (err) {
      log(`Website lookup: ${errorMessage(err)}`);
      if (err instanceof BudgetError) return 0;
    }
  }

  const withSite = companies.filter((c) => c.website);
  let sites = new Map<string, SiteContacts>();
  try {
    sites = await scrapeSites(withSite.map((c) => c.website!));
  } catch (err) {
    log(`Contact lookup: ${errorMessage(err)}`);
    if (err instanceof BudgetError) return 0;
  }

  let enriched = 0;
  for (const c of companies) {
    const site = sites.get(domainOf(c.website) ?? "");
    const { phone } = await saveSiteContacts(c, site);
    await saveApollo(c, log);
    await db
      .update(schema.companies)
      .set({ phone: c.phone || phone, enrichedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.companies.id, c.id));
    enriched++;
  }
  log(`Looked up ${enriched} companies (${withSite.length} had a website)`);
  return enriched;
}

/** Companies behind Strong-fit open jobs that have not been looked up yet. */
export async function companiesToEnrich(limit: number): Promise<string[]> {
  const db = await getDb();
  const strong = await db
    .select({ companyId: schema.jobs.companyId, score: schema.jobs.score })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.fit, "Strong"), inArray(schema.jobs.status, ["Found", "Drafted"])));
  const wanted = [...new Set(
    strong
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map((j) => j.companyId)
      .filter((id): id is string => !!id),
  )];
  if (!wanted.length) return [];
  const pending = await db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(and(inArray(schema.companies.id, wanted), isNull(schema.companies.enrichedAt)));
  const pendingIds = new Set(pending.map((c) => c.id));
  return wanted.filter((id) => pendingIds.has(id)).slice(0, limit);
}

// ---------- draft ----------

/** Best person to email at a company: verified person, then hiring inbox, then any. */
export async function bestContact(cId: string | null) {
  if (!cId) return null;
  const db = await getDb();
  const all = await db.select().from(schema.contacts).where(eq(schema.contacts.companyId, cId));
  const usable = all.filter((c) => c.email && !c.optedOut && c.status !== "Do not contact");
  const rank = (c: (typeof usable)[number]) =>
    c.emailStatus === "verified" ? 0 : /careers|hiring/i.test(c.title ?? "") ? 1 : c.emailStatus === "site" ? 2 : 3;
  return usable.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * Writes the email and CV selection for one job. Puts it in the Outbox when
 * there is someone to send it to; otherwise the draft stays on the job for a
 * portal application.
 */
export async function draftForJob(job: Job, profile: Profile): Promise<{ queued: boolean }> {
  const db = await getDb();
  const [company] = job.companyId
    ? await db.select().from(schema.companies).where(eq(schema.companies.id, job.companyId))
    : [];
  const contact = await bestContact(job.companyId);
  const draft = await draftApplication(
    profile,
    {
      company: job.company,
      role: job.role,
      location: job.location,
      description: job.description ?? job.notes,
      companyAbout: company?.about,
    },
    contact,
  );

  await db
    .update(schema.jobs)
    .set({
      // A cover letter the user already has is never overwritten.
      cover: job.cover || draft.body,
      cvVariant: draft.cvVariant,
      status: job.status === "Found" ? "Drafted" : job.status,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, job.id));

  if (!contact?.email) return { queued: false };
  const existing = await db
    .select({ id: schema.outbox.id })
    .from(schema.outbox)
    .where(eq(schema.outbox.jobId, job.id));
  if (existing.length) return { queued: false };

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
    .where(
      and(
        eq(schema.jobs.fit, "Strong"),
        inArray(schema.jobs.status, ["Found", "Drafted"]),
        isNull(schema.jobs.cvVariant),
      ),
    );
  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  let drafted = 0;
  let queued = 0;
  for (const job of candidates.slice(0, limit)) {
    try {
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

export async function checkReplies(log: Log): Promise<number> {
  const db = await getDb();
  const waiting = await db
    .select()
    .from(schema.outbox)
    .where(and(eq(schema.outbox.status, "sent"), isNull(schema.outbox.repliedAt)));
  if (!waiting.length) return 0;

  let replied: Set<string>;
  try {
    replied = await findReplies(
      waiting.filter((w) => w.sentAt).map((w) => ({ email: w.to, since: w.sentAt! })),
    );
  } catch (err) {
    log(`Reply check: ${errorMessage(err)}`);
    return 0;
  }

  let count = 0;
  for (const item of waiting) {
    if (!replied.has(item.to.toLowerCase())) continue;
    const now = new Date();
    await db
      .update(schema.outbox)
      .set({ repliedAt: now, updatedAt: now })
      .where(eq(schema.outbox.id, item.id));
    if (item.jobId) {
      await db
        .update(schema.jobs)
        .set({ status: "Replied", followUp: null, updatedAt: now })
        .where(and(eq(schema.jobs.id, item.jobId), eq(schema.jobs.status, "Applied")));
    }
    if (item.contactId) {
      await db
        .update(schema.contacts)
        .set({ status: "Replied", nextFollowUp: null, updatedAt: now })
        .where(eq(schema.contacts.id, item.contactId));
    }
    count++;
  }
  if (count) log(`${count} new replies found in Gmail`);
  return count;
}

export async function draftFollowUps(
  profile: Profile,
  settings: AppSettings,
  log: Log,
  limit = 5,
): Promise<number> {
  const db = await getDb();
  const all = await db.select().from(schema.outbox);
  const hasFollowUp = new Set(all.map((o) => o.followUpOf).filter(Boolean));
  const due = all.filter(
    (o) =>
      o.status === "sent" &&
      !o.followUpOf &&
      !o.repliedAt &&
      o.sentAt &&
      !hasFollowUp.has(o.id) &&
      daysBetween(o.sentAt.toISOString()) >= settings.outreach.followUpDays,
  );

  let drafted = 0;
  for (const o of due.slice(0, limit)) {
    const [job] = o.jobId
      ? await db.select().from(schema.jobs).where(eq(schema.jobs.id, o.jobId))
      : [];
    if (job && ["Rejected", "Skipped", "Offer", "Interview", "Replied"].includes(job.status)) continue;
    try {
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
      drafted++;
    } catch (err) {
      log(`Follow-up for ${o.to}: ${errorMessage(err)}`);
    }
  }
  if (drafted) log(`Wrote ${drafted} follow-ups`);
  return drafted;
}

export { profileIsReady };
