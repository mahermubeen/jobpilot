import { eq } from "drizzle-orm";
import { HttpError, route } from "@/lib/api";
import { parseFields, type FieldAnswer } from "@/lib/apply/answers";
import { pageJob, parsePageJob } from "@/lib/apply/page-job";
import { resolveAnswers, type FillStats } from "@/lib/apply/resolve";
import { assertLocalCaller } from "@/lib/apply/guard";
import { profileIsReady } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import { getProfile, getSettings } from "@/lib/settings";
import { errorMessage, uid } from "@/lib/util";

type Ticket = { at: number; answers?: FieldAnswer[]; stats?: FillStats; error?: string };

// Writing answers can take half a minute, longer than a browser extension may
// wait on one request, so the work runs in the background and is polled.
const store = globalThis as unknown as { __jobpilotApplyTickets?: Map<string, Ticket> };
const tickets = (store.__jobpilotApplyTickets ??= new Map());
const KEEP_MS = 10 * 60 * 1000;

/** Starts answering the fields of one application-form page. Nothing is submitted. */
export const POST = route(async (req: Request) => {
  assertLocalCaller(req);
  const body = (await req.json()) as { jobId?: string; page?: unknown; fields?: unknown; forceAi?: boolean };
  const fields = parseFields(body.fields);
  if (!fields.length) throw new HttpError(400, "No empty fields were found on this page.");

  // A saved job when there is one (it has the tailored CV and cover letter),
  // otherwise the job as the page itself describes it.
  const db = await getDb();
  const [saved] = body.jobId ? await db.select().from(schema.jobs).where(eq(schema.jobs.id, body.jobId)) : [];
  const page = parsePageJob(body.page);
  if (!saved && !page) throw new HttpError(400, body.jobId ? "Job not found." : "Pick a job first.");
  const job = saved ? { ...saved, description: saved.description ?? saved.notes } : pageJob(page!);
  const profile = await getProfile();
  if (!profileIsReady(profile)) throw new HttpError(400, "Add your CV in JobPilot Settings first.");
  const { applyAnswers, applyFacts } = await getSettings();

  const work = () =>
    resolveAnswers({
      profile,
      facts: applyFacts,
      saved: applyAnswers,
      job,
      fields,
      forceAi: !!body.forceAi,
    });

  for (const [id, t] of tickets) if (Date.now() - t.at > KEEP_MS) tickets.delete(id);
  const ticket = uid();
  const entry: Ticket = { at: Date.now() };
  tickets.set(ticket, entry);
  void work().then(
    (r) => Object.assign(entry, r),
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
  return entry.answers ? { answers: entry.answers, stats: entry.stats } : { pending: true };
});
