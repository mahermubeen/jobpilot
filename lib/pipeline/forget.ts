import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { jobKeys } from "./dedupe";

/**
 * Deletes jobs (with their outbox drafts) and remembers their keys, so a
 * later search never adds them back. Returns how many were deleted.
 */
export async function dismissJobs(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const db = await getDb();
  const rows = await db
    .select({ company: schema.jobs.company, role: schema.jobs.role, link: schema.jobs.link, source: schema.jobs.source, sourceId: schema.jobs.sourceId })
    .from(schema.jobs)
    .where(inArray(schema.jobs.id, ids));
  const keys = rows.flatMap((r) => jobKeys(r).map((key) => ({ key, company: r.company, role: r.role })));
  if (keys.length) await db.insert(schema.dismissedJobs).values(keys).onConflictDoNothing();
  await db.delete(schema.outbox).where(inArray(schema.outbox.jobId, ids));
  const gone = await db.delete(schema.jobs).where(inArray(schema.jobs.id, ids)).returning({ id: schema.jobs.id });
  return gone.length;
}

/** Keys of every job you deleted. */
export async function dismissedKeys(): Promise<Set<string>> {
  const db = await getDb();
  return new Set((await db.select({ key: schema.dismissedJobs.key }).from(schema.dismissedJobs)).map((r) => r.key));
}

/** A job you add by hand on purpose is allowed back. */
export async function undismiss(job: Parameters<typeof jobKeys>[0]) {
  const keys = jobKeys(job);
  if (!keys.length) return;
  const db = await getDb();
  await db.delete(schema.dismissedJobs).where(inArray(schema.dismissedJobs.key, keys));
}
