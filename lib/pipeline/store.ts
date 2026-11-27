import { and, eq, inArray, isNull } from "drizzle-orm";
import { scoreJobs } from "@/lib/ai/tasks";
import type { Profile } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import type { Company, Job } from "@/lib/db/schema";
import { describeMinPay } from "@/lib/pay";
import type { AppSettings } from "@/lib/settings";
import { searchTitles } from "@/lib/sources/match";
import { parsePosted } from "@/lib/sources/posted";
import type { RawJob } from "@/lib/sources/types";
import { chunk, errorMessage, slug, today } from "@/lib/util";
import { companyId, dedupeJobs, findDuplicates, jobId } from "./dedupe";
import { homePlaces, rejectReason, type JobFilter } from "./filter";
import type { Log } from "./find";
import { dismissedKeys } from "./forget";

type Db = Awaited<ReturnType<typeof getDb>>;

/** Rows per multi-row insert; well under Postgres's parameter limit. */
const INSERT_BATCH = 100;
const SCORE_BATCH = 10;
/** Copies of a duplicate that may be removed: nothing done with them yet. */
const REMOVABLE = ["Found", "Skipped"];

type CompanyInfo = RawJob["company_"];

const filledStrings = (info: CompanyInfo): CompanyInfo =>
  Object.fromEntries(Object.entries(info).filter(([, v]) => typeof v === "string" && v.trim()));

export async function upsertCompany(name: string, info: RawJob["company_"] = {}): Promise<string> {
  const db = await getDb();
  const id = companyId(name);
  const [existing] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
  const clean = filledStrings(info) as Partial<Company>;
  if (!existing) {
    await db.insert(schema.companies).values({ id, name, ...clean });
    return id;
  }
  // Only fill gaps; never overwrite what the user or an earlier lookup saved.
  const patch = Object.fromEntries(Object.entries(clean).filter(([k]) => !existing[k as keyof Company]));
  if (Object.keys(patch).length) {
    await db.update(schema.companies).set({ ...patch, updatedAt: new Date() }).where(eq(schema.companies.id, id));
  }
  return id;
}

/** Inserts rows in batches; batches are independent, so they are written together. */
async function insertBatched<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>) {
  await Promise.all(chunk(rows, INSERT_BATCH).map(insert));
}

type StoredJob = Pick<Job, "id" | "company" | "role" | "link" | "source" | "sourceId" | "status" | "alsoOn">;

/** For each group of saved duplicates: the copy to keep, its merged sources, and the removable copies. */
function duplicatesToMerge(jobs: StoredJob[], sent: Set<string | null>) {
  return findDuplicates(jobs).flatMap(({ keep, extra }) => {
    const drop = extra.filter((j) => REMOVABLE.includes(j.status) && !sent.has(j.id));
    if (!drop.length) return [];
    const alsoOn = [...new Set([...(keep.alsoOn ?? []), ...drop.map((j) => j.source ?? "")])].filter((s) => s && s !== keep.source);
    return [{ keep, alsoOn, ids: drop.map((j) => j.id) }];
  });
}

/**
 * Saved jobs that turn out to be the same posting (saved before the duplicate
 * check knew them apart) are merged: the copy furthest along stays and lists
 * the others' sources. Only copies still in Found or Skipped without a sent
 * email are removed; jobs you acted on are never touched.
 */
async function mergeSavedDuplicates(db: Db, log: Log) {
  const [jobs, sentRows] = await Promise.all([
    db
      .select({
        id: schema.jobs.id, company: schema.jobs.company, role: schema.jobs.role, link: schema.jobs.link,
        source: schema.jobs.source, sourceId: schema.jobs.sourceId, status: schema.jobs.status, alsoOn: schema.jobs.alsoOn,
      })
      .from(schema.jobs),
    db.select({ jobId: schema.outbox.jobId }).from(schema.outbox).where(eq(schema.outbox.status, "sent")),
  ]);
  const merges = duplicatesToMerge(jobs, new Set(sentRows.map((o) => o.jobId)));
  if (!merges.length) return 0;
  await Promise.all(merges.map((m) => db.update(schema.jobs).set({ alsoOn: m.alsoOn }).where(eq(schema.jobs.id, m.keep.id))));
  const ids = merges.flatMap((m) => m.ids);
  await db.delete(schema.outbox).where(inArray(schema.outbox.jobId, ids));
  await db.delete(schema.jobs).where(inArray(schema.jobs.id, ids));
  for (const { keep, ids: removed } of merges) {
    log(`Merged duplicate: ${keep.company} · ${keep.role} (removed ${removed.length} extra cop${removed.length === 1 ? "y" : "ies"})`);
  }
  return ids.length;
}

// A post signed only by a handle ("u/name", "@name") names no company to look up.
const namesCompany = (j: RawJob) => !/^(u\/|@)/.test(j.company);

/**
 * One upsert per company (not per job). Details from several jobs are merged
 * in order, so the first job to name a detail wins, as when saved one by one.
 */
async function upsertCompanies(jobs: RawJob[]): Promise<void> {
  const byId = new Map<string, { name: string; info: CompanyInfo }>();
  for (const j of jobs.filter(namesCompany)) {
    const id = companyId(j.company);
    const entry = byId.get(id) ?? { name: j.company, info: {} };
    entry.info = { ...filledStrings(j.company_), ...filledStrings(entry.info) };
    byId.set(id, entry);
  }
  // Distinct ids, so the upserts cannot race each other.
  await Promise.all([...byId.values()].map(({ name, info }) => upsertCompany(name, info)));
}

function jobRow(j: RawJob, id: string, cId: string | null): typeof schema.jobs.$inferInsert {
  return {
    id,
    company: j.company,
    role: j.role,
    link: j.link,
    status: "Found",
    source: j.source,
    sourceId: j.sourceId,
    kind: j.kind ?? "listing",
    alsoOn: j.alsoOn ?? [],
    pay: j.pay || null,
    tier: j.tier || null,
    mode: j.mode || null,
    location: j.location || null,
    description: j.description || null,
    found: today(),
    postedAt: parsePosted(j.posted),
    companyId: cId,
  };
}

function recruiterRow(j: RawJob, cId: string | null): typeof schema.contacts.$inferInsert | null {
  if (!j.recruiter?.name || !cId) return null;
  return {
    id: slug(`${j.recruiter.name} ${j.company}`, "contact"),
    companyId: cId,
    company: j.company,
    name: j.recruiter.name,
    title: "Job poster",
    linkedin: j.recruiter.linkedin || null,
    source: j.source,
  };
}

/** Saves new jobs, their companies and the recruiters who posted them. */
async function saveNewJobs(db: Db, fresh: RawJob[], taken: Set<string>) {
  await upsertCompanies(fresh);
  // Ids are handed out in order, so a second "Acme · Engineer" becomes "...-2" as before.
  const rows = fresh.map((j) => {
    const cId = namesCompany(j) ? companyId(j.company) : null;
    return { job: jobRow(j, jobId(j.company, j.role, taken), cId), recruiter: recruiterRow(j, cId) };
  });
  await insertBatched(rows.map((r) => r.job), (batch) => db.insert(schema.jobs).values(batch));
  const recruiters = rows.flatMap((r) => (r.recruiter ? [r.recruiter] : []));
  await insertBatched(recruiters, (batch) => db.insert(schema.contacts).values(batch).onConflictDoNothing());
}

export async function storeJobs(raw: RawJob[], filter: JobFilter, log: Log): Promise<number> {
  const db = await getDb();
  await mergeSavedDuplicates(db, log);
  const existing = await db
    .select({ id: schema.jobs.id, company: schema.jobs.company, role: schema.jobs.role, link: schema.jobs.link, source: schema.jobs.source, sourceId: schema.jobs.sourceId })
    .from(schema.jobs);
  const onBoard = dedupeJobs(raw, existing);
  const unique = dedupeJobs(onBoard, [], await dismissedKeys());
  const fresh = unique.filter((j) => !rejectReason(j, filter));
  await saveNewJobs(db, fresh, new Set(existing.map((j) => j.id)));

  const deletedBefore = onBoard.length - unique.length;
  log(
    `Saved ${fresh.length} new jobs (skipped ${raw.length - onBoard.length} already on your board or found twice` +
      `${deletedBefore > 0 ? `, ${deletedBefore} you deleted before` : ""})`,
  );
  if (unique.length > fresh.length) log(`Filtered out ${unique.length - fresh.length} jobs (pay or location)`);
  return fresh.length;
}

// ---------- score ----------

function scoringTargets(settings: AppSettings) {
  return {
    titles: searchTitles(settings.search),
    locations: settings.search.locations.map((l) => l.label),
    minPay: describeMinPay(settings.search.minPay),
    homeCity: settings.search.homeCity.trim(),
    homePlaces: homePlaces(settings.search),
  };
}

const forScoring = (j: Job) => ({ id: j.id, company: j.company, role: j.role, location: j.location, pay: j.pay, description: j.description ?? j.notes });

/** Scores one batch and writes the results back. Returns how many jobs were scored. */
async function scoreBatch(db: Db, profile: Profile, batch: Job[], targets: ReturnType<typeof scoringTargets>): Promise<number> {
  const results = await scoreJobs(profile, batch.map(forScoring), targets);
  const byId = new Map(batch.map((j) => [j.id, j]));
  const matched = results.flatMap((r) => {
    const job = byId.get(r.id);
    return job ? [{ r, job }] : [];
  });
  await Promise.all(
    matched.map(({ r, job }) =>
      db
        .update(schema.jobs)
        .set({
          fit: r.fit,
          score: r.score,
          flags: [...new Set([...(job.flags ?? []), ...r.flags])],
          notes: job.notes || r.reason,
          status: r.fit === "Skip" ? "Skipped" : job.status,
          updatedAt: new Date(),
        })
        .where(eq(schema.jobs.id, r.id)),
    ),
  );
  return matched.length;
}

export async function scoreNewJobs(profile: Profile, settings: AppSettings, log: Log, limit = 60): Promise<number> {
  const db = await getDb();
  const pending = await db
    .select()
    .from(schema.jobs)
    .where(and(isNull(schema.jobs.fit), eq(schema.jobs.status, "Found")))
    .limit(limit);
  if (!pending.length) return 0;

  const targets = scoringTargets(settings);
  let scored = 0;
  for (const batch of chunk(pending, SCORE_BATCH)) {
    try {
      // One model call at a time, stopping at the first failure, so a broken model costs one call, not six.
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose: stop at the first failed AI batch
      scored += await scoreBatch(db, profile, batch, targets);
    } catch (err) {
      log(`Scoring failed for a batch: ${errorMessage(err)}`);
      break;
    }
  }
  log(`Scored ${scored} jobs`);
  return scored;
}
