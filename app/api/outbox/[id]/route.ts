import { eq } from "drizzle-orm";
import { HttpError, pick, route, type IdParams } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { OUTBOX_FIELDS } from "@/lib/fields";

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const patch = pick(await req.json(), OUTBOX_FIELDS) as Record<string, unknown>;
  const db = await getDb();
  const [item] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, id));
  if (!item) throw new HttpError(404, "Email not found.");
  if (["sent", "sending"].includes(item.status)) {
    throw new HttpError(400, "A sent email cannot be changed.");
  }
  // The browser can only move an email between waiting states; "sent" is set by the server.
  if ("status" in patch && !["queued", "approved"].includes(String(patch.status))) {
    delete patch.status;
  }
  for (const k of ["to", "subject", "body"]) if (patch[k] == null) delete patch[k];
  await db
    .update(schema.outbox)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.outbox.id, id));
  return { ok: true };
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const db = await getDb();
  const [item] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, id));
  if (item?.status === "sent") throw new HttpError(400, "Sent emails are kept as a record.");
  await db.delete(schema.outbox).where(eq(schema.outbox.id, id));
  return { ok: true };
});
