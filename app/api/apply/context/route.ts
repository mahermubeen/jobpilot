import { desc } from "drizzle-orm";
import { route } from "@/lib/api";
import { matchJob } from "@/lib/apply/answers";
import { assertLocalCaller } from "@/lib/apply/guard";
import { profileIsReady } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import { getProfile, getState } from "@/lib/settings";

const ACTIVE_FOR_MS = 3 * 60 * 60 * 1000;
const CLOSED = ["Rejected", "Skipped"];

/** Tells the extension which saved job a browser tab belongs to. */
export const GET = route(async (req: Request) => {
  assertLocalCaller(req);
  const url = new URL(req.url).searchParams.get("url") ?? "";
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

  const brief = (j: (typeof jobs)[number]) => ({ id: j.id, company: j.company, role: j.role });
  return {
    job: job ? brief(job) : null,
    matchedBy,
    jobs: jobs.filter((j) => !CLOSED.includes(j.status)).slice(0, 80).map(brief),
    profileReady: profileIsReady(await getProfile()),
  };
});
