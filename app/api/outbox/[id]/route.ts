import { and, eq, notInArray } from "drizzle-orm";
import { HttpError, pick, route, type IdParams } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { OUTBOX_FIELDS } from "@/lib/fields";

/** Emails that have left, or are leaving, and can no longer be edited. */
const LOCKED = new Set(["sent", "sending"]);
/** The only statuses the browser may set; "sent" is set by the server. */
const WAITING = new Set(["queued", "approved"]);
/** This email, as long as it is still waiting: the condition on every write, so a send that starts meanwhile wins. */
const stillWaiting = (id: string) => and(eq(schema.outbox.id, id), notInArray(schema.outbox.status, [...LOCKED]));

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const patch = pick(await req.json(), OUTBOX_FIELDS) as Record<string, unknown>;
  const db = await getDb();
  const [item] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, id));
  if (!item) throw new HttpError(404, "Email not found.");
  if (LOCKED.has(item.status)) {
    throw new HttpError(400, "A sent email cannot be changed.");
  }
  // The browser can only move an email between waiting states; "sent" is set by the server.
  if ("status" in patch && !WAITING.has(String(patch.status))) {
    delete patch.status;
  }
  for (const k of ["to", "subject", "body"]) if (patch[k] == null) delete patch[k];
  const changed = await db
    .update(schema.outbox)
    .set({ ...patch, updatedAt: new Date() })
    .where(stillWaiting(id))
    .returning({ id: schema.outbox.id });
  if (!changed.length) throw new HttpError(400, "A sent email cannot be changed.");
  return { ok: true };
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const db = await getDb();
  const [item] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, id));
  if (item && LOCKED.has(item.status)) throw new HttpError(400, "This email is being sent or was sent, so it is kept as a record.");
  const removed = await db.delete(schema.outbox).where(stillWaiting(id)).returning({ id: schema.outbox.id });
  // It started sending between the check and the delete.
  if (item && !removed.length) throw new HttpError(400, "This email is being sent or was sent, so it is kept as a record.");
  return { ok: true };
});
