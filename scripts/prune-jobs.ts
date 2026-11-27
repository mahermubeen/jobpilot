/**
 * Deletes saved jobs that fall outside the pay and place rules in
 * Settings → Search. Stop the app first: the database allows one process.
 *
 *   npm run prune:jobs              lists what would be deleted
 *   npm run prune:jobs -- --apply   backs up the database, then deletes
 *
 * Jobs you have already applied to are never deleted.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { dataDir, getDb, schema } from "../lib/db";
import { KEEP_STATUSES } from "../lib/pipeline/cleanup";
import { dismissJobs } from "../lib/pipeline/forget";
import { rejectReason } from "../lib/pipeline/filter";
import { getSettings } from "../lib/settings";

async function main() {
  const apply = process.argv.includes("--apply");
  const dbDir = path.join(dataDir(), "db");
  if (apply && !process.env.DATABASE_URL && fs.existsSync(dbDir)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(dataDir(), "backups", `db-${stamp}`);
    fs.cpSync(dbDir, backup, { recursive: true });
    console.log(`Backup saved to ${backup}`);
  }

  const db = await getDb();
  const { search } = await getSettings();
  const jobs = await db.select().from(schema.jobs);

  const doomed = jobs.flatMap((job) => {
    if (KEEP_STATUSES.includes(job.status)) return [];
    const reason = rejectReason({ ...job, description: job.description ?? job.notes }, search);
    return reason ? [{ job, reason }] : [];
  });

  for (const { job, reason } of doomed) {
    console.log(`${job.company} | ${job.role} | ${job.status} | ${reason}`);
  }
  console.log(`\n${doomed.length} of ${jobs.length} jobs fall outside your filters.`);

  if (!apply) {
    console.log("Nothing was deleted. Run again with --apply to delete them.");
    return;
  }
  const ids = doomed.map((d) => d.job.id);
  if (ids.length) {
    const sent = await db
      .select({ jobId: schema.outbox.jobId })
      .from(schema.outbox)
      .where(eq(schema.outbox.status, "sent"));
    const emailed = new Set(sent.map((s) => s.jobId));
    const safe = ids.filter((id) => !emailed.has(id));
    // Remembered, so a later search does not add them back.
    await dismissJobs(safe);
    console.log(`Deleted ${safe.length} jobs.`);
    if (safe.length < ids.length) console.log(`Kept ${ids.length - safe.length} that already have a sent email.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
