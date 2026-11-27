import { eq } from "drizzle-orm";
import { HttpError, route } from "@/lib/api";
import { parseFields } from "@/lib/apply/answers";
import { jobForUrl } from "@/lib/apply/context";
import { pageScope } from "@/lib/apply/page-job";
import { findAnswers, getLearned } from "@/lib/apply/learned";
import { assertLocalCaller } from "@/lib/apply/guard";
import { resolveAnswers } from "@/lib/apply/resolve";
import { profileIsReady } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import { getProfile, getSettings } from "@/lib/settings";

/**
 * Instant answer suggestions for fields as they appear on a page, from what
 * JobPilot already knows: your CV, your answers, the answer bank and the
 * record. Never calls the AI, so it costs no tokens.
 * Body: `{ url, jobId?, fields }`.
 */
export const POST = route(async (req: Request) => {
  assertLocalCaller(req);
  const body = (await req.json()) as { url?: string; jobId?: string; fields?: unknown };
  const fields = parseFields(body.fields);
  if (!fields.length) return { jobId: null, answers: [] };

  const db = await getDb();
  let job = null;
  if (body.jobId) [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, body.jobId));
  if (!job) {
    const found = (await jobForUrl(body.url ?? "")).job;
    if (found) [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, found.id));
  }
  const profile = await getProfile();
  if (!profileIsReady(profile)) throw new HttpError(400, "Add your CV in JobPilot Settings first.");
  const { applyAnswers, applyFacts } = await getSettings();

  // Without a saved job, the answers that don't depend on one still work.
  const theJob = job
    ? { ...job, description: job.description ?? job.notes }
    : { id: body.url ? pageScope(body.url) : "", company: "", role: "" };
  const { answers } = await resolveAnswers({
    profile,
    facts: applyFacts,
    saved: applyAnswers,
    job: theJob,
    fields,
    ai: false,
  });
  // Other close answers from the record, for the dropdown under the best one.
  const learned = await getLearned();
  const out = answers
    .filter((a) => !a.skip)
    .map((a) => {
      const field = fields.find((f) => f.id === a.id)!;
      const same = (v: unknown) => JSON.stringify(v).toLowerCase() === JSON.stringify(a.value).toLowerCase();
      const alternatives = findAnswers(field, learned, theJob.id, 4)
        .filter((h) => !same(h.value))
        .slice(0, 2)
        .map((h) => ({ value: h.value, source: h.entry.by === "you" ? "saved" : "learned" }));
      return { ...a, alternatives };
    })
    .filter((a) => a.value !== null || a.alternatives.length);
  return { jobId: job?.id ?? null, answers: out };
});
