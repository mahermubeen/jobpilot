import { eq } from "drizzle-orm";
import { HttpError, pick, route, type IdParams } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { JOB_FIELDS } from "@/lib/fields";
import { today } from "@/lib/util";

const APPLIED_PLUS = new Set(["Applied", "Replied", "Interview", "Offer", "Rejected"]);

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const patch = pick(await req.json(), JOB_FIELDS) as Record<string, unknown>;
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
  if (!job) throw new HttpError(404, "Job not found.");
  if (patch.flags && !Array.isArray(patch.flags)) delete patch.flags;
  if (typeof patch.status === "string" && APPLIED_PLUS.has(patch.status) && !job.applied && !patch.applied) {
    patch.applied = today();
  }
  await db
    .update(schema.jobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.jobs.id, id));
  return { ok: true };
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const db = await getDb();
  await db.delete(schema.outbox).where(eq(schema.outbox.jobId, id));
  await db.delete(schema.jobs).where(eq(schema.jobs.id, id));
  return { ok: true };
});
