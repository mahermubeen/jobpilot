import { eq } from "drizzle-orm";
import { answerFormFields } from "@/lib/ai/tasks";
import { HttpError, route } from "@/lib/api";
import { parseFields, profileAnswer, validateAnswer, type FieldAnswer } from "@/lib/apply/answers";
import { assertLocalCaller } from "@/lib/apply/guard";
import { profileIsReady } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import { getProfile, getSettings } from "@/lib/settings";
import { errorMessage, uid } from "@/lib/util";

type Ticket = { at: number; answers?: FieldAnswer[]; error?: string };

// Writing answers can take half a minute, longer than a browser extension may
// wait on one request, so the work runs in the background and is polled.
const store = globalThis as unknown as { __jobpilotApplyTickets?: Map<string, Ticket> };
const tickets = (store.__jobpilotApplyTickets ??= new Map());
const KEEP_MS = 10 * 60 * 1000;

/** Starts answering the fields of one application-form page. Nothing is submitted. */
export const POST = route(async (req: Request) => {
  assertLocalCaller(req);
  const body = (await req.json()) as { jobId?: string; fields?: unknown };
  const fields = parseFields(body.fields);
  if (!body.jobId) throw new HttpError(400, "Pick a job first.");
  if (!fields.length) throw new HttpError(400, "No empty fields were found on this page.");

  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, body.jobId));
  if (!job) throw new HttpError(404, "Job not found.");
  const profile = await getProfile();
  if (!profileIsReady(profile)) throw new HttpError(400, "Add your CV in JobPilot Settings first.");
  const { applyAnswers } = await getSettings();

  const work = async (): Promise<FieldAnswer[]> => {
    const answers = new Map<string, FieldAnswer>();
    for (const f of fields) {
      const value = validateAnswer(f, profileAnswer(f, profile));
      if (value !== null) answers.set(f.id, { id: f.id, value, source: "profile" });
    }
    const open = fields.filter((f) => !answers.has(f.id) && f.type !== "file");
    if (open.length) {
      const raw = await answerFormFields(
        profile,
        { ...job, description: job.description ?? job.notes },
        applyAnswers,
        open,
      );
      for (const f of open) {
        const value = validateAnswer(f, raw.get(f.id));
        answers.set(f.id, { id: f.id, value, source: value === null ? "none" : "ai" });
      }
    }
    return fields.map((f) => answers.get(f.id) ?? { id: f.id, value: null, source: "none" });
  };

  for (const [id, t] of tickets) if (Date.now() - t.at > KEEP_MS) tickets.delete(id);
  const ticket = uid();
  const entry: Ticket = { at: Date.now() };
  tickets.set(ticket, entry);
  void work().then(
    (answers) => (entry.answers = answers),
    (err) => (entry.error = errorMessage(err)),
  );
  return { ticket };
});

/** Poll for the result of a POST: `{ pending: true }` until it is ready. */
export const GET = route(async (req: Request) => {
  assertLocalCaller(req);
  const entry = tickets.get(new URL(req.url).searchParams.get("ticket") ?? "");
  if (!entry) throw new HttpError(404, "That request has expired. Press Fill again.");
  if (entry.error) throw new HttpError(500, entry.error);
  return entry.answers ? { answers: entry.answers } : { pending: true };
});
