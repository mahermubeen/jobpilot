import { desc, eq } from "drizzle-orm";
import { profileIsReady } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import { getProfile, getSecrets, getSettings, setState } from "@/lib/settings";
import type { PostedWithin } from "@/lib/sources/posted";
import { errorMessage, today, uid } from "@/lib/util";
import {
  checkReplies,
  companiesToEnrich,
  draftFollowUps,
  draftStrongJobs,
  enrichCompanies,
  findJobs,
  scoreNewJobs,
  storeJobs,
} from "./steps";
import { ensureTitleVariants } from "./titles";

export type RunKind = "find" | "daily" | "inbox";

const g = globalThis as unknown as { __jobpilotRun?: string | null };

export const currentRunId = () => g.__jobpilotRun ?? null;

/**
 * Starts the pipeline in the background and returns the run id straight away.
 * Only one run at a time; progress is written to the `runs` table for the UI.
 *
 * find  - search, score, look up companies, write drafts, check replies
 * daily - same, always for jobs posted in the past 24 hours
 * inbox - only reply check and follow-up drafts (no scraping)
 *
 * `postedWithinDays` is how far back the search looks (past 24 hours by default).
 */
export async function startRun(
  kind: RunKind,
  postedWithinDays: PostedWithin = 1,
): Promise<{ id: string; started: boolean }> {
  if (g.__jobpilotRun) return { id: g.__jobpilotRun, started: false };
  const id = uid();
  g.__jobpilotRun = id;
  const db = await getDb();
  await db.insert(schema.runs).values({ id, kind, step: "Starting" });
  void execute(id, kind, kind === "daily" ? 1 : postedWithinDays).finally(() => {
    g.__jobpilotRun = null;
  });
  return { id, started: true };
}

async function execute(id: string, kind: RunKind, postedWithinDays: PostedWithin) {
  const db = await getDb();
  const lines: string[] = [];
  const stats: Record<string, number> = {};

  const save = (step: string | null, extra: Partial<typeof schema.runs.$inferInsert> = {}) =>
    db
      .update(schema.runs)
      .set({ step, stats, log: lines.join("\n"), ...extra })
      .where(eq(schema.runs.id, id));
  const log = (line: string) => {
    lines.push(line);
    void save(null).catch(() => {});
  };

  try {
    const [settings, secrets, profile] = await Promise.all([
      getSettings(),
      getSecrets(),
      getProfile(),
    ]);
    if (!profileIsReady(profile)) throw new Error("Add your CV in Settings first.");

    if (kind !== "inbox") {
      if (!settings.search.titles.length || !settings.search.locations.length) {
        throw new Error("Add at least one job title and one location in Settings.");
      }

      await save("Preparing job titles");
      const searchSettings = await ensureTitleVariants(settings, profile, log);

      await save("Searching job boards, career pages and hiring posts");
      const raw = await findJobs(searchSettings, log, postedWithinDays, secrets);
      stats.found = raw.length;
      stats.sources = new Set(raw.map((j) => j.source)).size;

      await save("Saving new jobs");
      stats.new = await storeJobs(raw, settings.search, log);

      await save("Scoring fit");
      stats.scored = await scoreNewJobs(profile, settings, log);

      await save("Looking up companies and contacts");
      const ids = await companiesToEnrich(settings.caps.enrichPerRun);
      stats.companies = await enrichCompanies(ids, log);

      await save("Writing applications");
      stats.drafted = await draftStrongJobs(profile, settings.caps.draftPerRun, log);
    }

    if (secrets.gmailUser && secrets.gmailAppPassword) {
      await save("Checking Gmail for replies");
      stats.replies = await checkReplies(log);
      await save("Writing follow-ups");
      stats.followUps = await draftFollowUps(profile, settings, log);
    }

    await save("Done", { status: "done", finishedAt: new Date() });
  } catch (err) {
    lines.push(`Stopped: ${errorMessage(err)}`);
    await save("Stopped", { status: "failed", finishedAt: new Date() }).catch(() => {});
  } finally {
    if (kind === "daily") await setState("lastDailyRun", today()).catch(() => {});
  }
}

export async function recentRuns(limit = 10) {
  const db = await getDb();
  return db.select().from(schema.runs).orderBy(desc(schema.runs.startedAt)).limit(limit);
}

/** Runs left "running" by a crash or restart are closed so the UI doesn't wait forever. */
export async function closeStaleRuns() {
  const db = await getDb();
  await db
    .update(schema.runs)
    .set({ status: "failed", step: "Stopped", finishedAt: new Date() })
    .where(eq(schema.runs.status, "running"));
}
