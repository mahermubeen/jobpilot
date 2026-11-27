import { HttpError, route } from "@/lib/api";
import { assertLocalCaller } from "@/lib/apply/guard";
import { eq } from "drizzle-orm";
import { parseFields, validateAnswer } from "@/lib/apply/answers";
import { getLearned, isJobSpecific, learn, updateLearned } from "@/lib/apply/learned";
import { getDb, schema } from "@/lib/db";
import { pageJob, parsePageJob } from "@/lib/apply/page-job";

/** Answers JobPilot remembered from earlier forms, newest first. */
export const GET = route(async (req: Request) => {
  assertLocalCaller(req);
  const list = await getLearned();
  return { answers: list.sort((a, b) => b.at - a.at) };
});

/** Corrects a remembered answer: `{ id, answer }`. */
export const PATCH = route(async (req: Request) => {
  assertLocalCaller(req);
  const { id, answer } = (await req.json()) as { id?: string; answer?: unknown };
  if (!id) throw new HttpError(400, "id is required.");
  const clean = Array.isArray(answer) ? answer.map(String) : String(answer ?? "").trim();
  if (!clean.length) throw new HttpError(400, "An answer is required. Delete it instead.");
  await updateLearned(id, clean);
  return { ok: true };
});

/** Forgets a remembered answer: `?id=`. */
export const DELETE = route(async (req: Request) => {
  assertLocalCaller(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "id is required.");
  await updateLearned(id, null);
  return { ok: true };
});

// Never kept, whatever the form calls them.
const SECRET = /password|passcode|\bpin\b|social security|\bssn\b|national id|\bcnic\b|passport (no|number)|credit card|card number|cvv|iban|bank account|security (code|question)/i;

/**
 * Answers you gave yourself on a form, sent by the extension when you press
 * Submit / Next: `{ jobId, items: [{ label, type, options?, value }] }`.
 * They are remembered as yours and win over the answer bank next time.
 */
export const POST = route(async (req: Request) => {
  assertLocalCaller(req);
  const body = (await req.json()) as { jobId?: string; page?: unknown; items?: unknown };
  const raw = Array.isArray(body.items) ? body.items : [];
  const fields = parseFields(raw.map((x, i) => ({ ...(x as object), id: `u${i}` })));
  let company = "";
  let scope = "";
  if (body.jobId) {
    const db = await getDb();
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, body.jobId));
    if (job) [company, scope] = [job.company, job.id];
  }
  // Not a saved job: answers written for this company stay with this page.
  const page = scope ? null : parsePageJob(body.page);
  if (page) [company, scope] = [page.company, pageJob(page).id];
  const toLearn: Parameters<typeof learn>[0] = [];
  fields.forEach((f, i) => {
    if (f.type === "file" || SECRET.test(f.label)) return;
    const value = validateAnswer(f, (raw[i] as { value?: unknown }).value, 1000);
    if (value === null || (Array.isArray(value) && !value.length)) return;
    toLearn.push({
      question: f.label,
      answer: value,
      type: f.type,
      scope: scope && isJobSpecific(f, company) ? scope : "all",
      by: "you",
    });
  });
  await learn(toLearn);
  return { saved: toLearn.map((t) => ({ question: t.question, answer: t.answer })) };
});
