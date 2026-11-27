import { eq } from "drizzle-orm";
import { HttpError, route } from "@/lib/api";
import { type FieldAnswer, type FormField, parseFields } from "@/lib/apply/answers";
import { jobForUrl } from "@/lib/apply/context";
import { pageScope } from "@/lib/apply/page-job";
import { findAnswers, getLearned } from "@/lib/apply/learned";
import { assertLocalCaller } from "@/lib/apply/guard";
import { resolveAnswers } from "@/lib/apply/resolve";
import { profileIsReady } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import { getProfile, getSettings } from "@/lib/settings";

type SuggestBody = { url?: string; jobId?: string; fields?: unknown };

const jobById = async (id: string) => (await (await getDb()).select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0];

/** The saved job by id, else the one this page's URL belongs to. */
async function savedJob(body: SuggestBody) {
  const byId = body.jobId ? await jobById(body.jobId) : undefined;
  if (byId) return byId;
  const found = (await jobForUrl(body.url ?? "")).job;
  return found ? jobById(found.id) : undefined;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a).toLowerCase() === JSON.stringify(b).toLowerCase();

/** Each answer with up to two other close answers from the record, for the dropdown under the best one. */
async function withAlternatives(answers: FieldAnswer[], fields: FormField[], jobId: string) {
  const learned = await getLearned();
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  return answers
    .filter((a) => !a.skip)
    .map((a) => {
      const alternatives = findAnswers(fieldById.get(a.id)!, learned, jobId, 4)
        .filter((h) => !sameValue(h.value, a.value))
        .slice(0, 2)
        .map((h) => ({ value: h.value, source: h.entry.by === "you" ? "saved" : "learned" }));
      return { ...a, alternatives };
    })
    .filter((a) => a.value !== null || a.alternatives.length);
}

/**
 * Instant answer suggestions for fields as they appear on a page, from what
 * JobPilot already knows: your CV, your answers, the answer bank and the
 * record. Never calls the AI, so it costs no tokens.
 * Body: `{ url, jobId?, fields }`.
 */
export const POST = route(async (req: Request) => {
  assertLocalCaller(req);
  const body = (await req.json()) as SuggestBody;
  const fields = parseFields(body.fields);
  if (!fields.length) return { jobId: null, answers: [] };

  const job = await savedJob(body);
  const profile = await getProfile();
  if (!profileIsReady(profile)) throw new HttpError(400, "Add your CV in JobPilot Settings first.");
  const { applyAnswers, applyFacts } = await getSettings();

  // Without a saved job, the answers that don't depend on one still work.
  const theJob = job ? { ...job, description: job.description ?? job.notes } : { id: body.url ? pageScope(body.url) : "", company: "", role: "" };
  const { answers } = await resolveAnswers({ profile, facts: applyFacts, saved: applyAnswers, job: theJob, fields, ai: false });
  return { jobId: job?.id ?? null, answers: await withAlternatives(answers, fields, theJob.id) };
});
