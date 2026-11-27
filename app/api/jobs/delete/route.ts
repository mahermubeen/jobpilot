import { eq } from "drizzle-orm";
import { HttpError, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { isOlderThan, isOlderThanHours, KEEP_STATUSES } from "@/lib/pipeline/cleanup";
import { rejectReason } from "@/lib/pipeline/filter";
import { dismissJobs } from "@/lib/pipeline/forget";
import { getSettings } from "@/lib/settings";

/**
 * Deletes many jobs at once, with their outbox drafts.
 * { ids } deletes exactly those jobs. { olderThanHours } deletes jobs posted
 * (or, without a posting date, found) longer ago than that. { outsideFilters }
 * deletes jobs that break the pay and place rules in Settings. The last two
 * keep jobs you applied to and jobs with a sent email; with { dryRun } they
 * only list what would go.
 */
export const POST = route(async (req: Request) => {
  const body = (await req.json()) as {
    ids?: unknown;
    olderThanHours?: unknown;
    outsideFilters?: unknown;
    dryRun?: unknown;
  };
  const db = await getDb();

  if (Array.isArray(body.ids)) {
    return { deleted: await remove(body.ids.filter((id): id is string => typeof id === "string")), kept: 0 };
  }

  let matches: { id: string; company: string; role: string; reason: string }[];
  if (isOlderThanHours(body.olderThanHours)) {
    const hours = body.olderThanHours;
    const jobs = await db.select().from(schema.jobs);
    matches = jobs.filter((j) => isOlderThan(j, hours)).map((j) => ({ ...j, reason: `Older than ${hours}h` }));
  } else if (body.outsideFilters === true) {
    const { search } = await getSettings();
    const jobs = await db.select().from(schema.jobs);
    matches = jobs.flatMap((j) => {
      if (KEEP_STATUSES.includes(j.status)) return [];
      const reason = rejectReason({ ...j, description: j.description ?? j.notes }, search);
      return reason ? [{ ...j, reason }] : [];
    });
  } else {
    throw new HttpError(400, "Send ids, olderThanHours (24, 48 or 72) or outsideFilters.");
  }

  const sent = await db
    .select({ jobId: schema.outbox.jobId })
    .from(schema.outbox)
    .where(eq(schema.outbox.status, "sent"));
  const emailed = new Set(sent.map((s) => s.jobId));
  const doomed = matches
    .filter((m) => !emailed.has(m.id))
    .map(({ id, company, role, reason }) => ({ id, company, role, reason }));
  const kept = matches.length - doomed.length;

  if (body.dryRun === true) return { jobs: doomed, kept };
  return { deleted: await remove(doomed.map((d) => d.id)), kept };
});

// Deleted jobs are remembered, so a later search does not add them back.
const remove = (ids: string[]) => dismissJobs(ids);
