import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getState } from "@/lib/settings";
import { matchJob } from "./answers";

const ACTIVE_FOR_MS = 3 * 60 * 60 * 1000;

/** The saved job a page belongs to: by its address, else the job you last opened from JobPilot. */
export async function jobForUrl(url: string) {
  const db = await getDb();
  const jobs = await db
    .select({
      id: schema.jobs.id,
      company: schema.jobs.company,
      role: schema.jobs.role,
      link: schema.jobs.link,
      status: schema.jobs.status,
    })
    .from(schema.jobs)
    .orderBy(desc(schema.jobs.updatedAt));

  let job = matchJob(url, jobs);
  let matchedBy: "url" | "opened" | null = job ? "url" : null;
  const active = await getState<{ jobId: string; at: number }>("applyActive");
  if (!job && active && Date.now() - active.at < ACTIVE_FOR_MS) {
    job = jobs.find((j) => j.id === active.jobId) ?? null;
    if (job) matchedBy = "opened";
  }
  return { job, matchedBy, jobs };
}
