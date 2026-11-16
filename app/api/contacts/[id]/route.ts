import { eq } from "drizzle-orm";
import { pick, route, type IdParams } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { CONTACT_FIELDS } from "@/lib/fields";

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const patch = pick(await req.json(), CONTACT_FIELDS) as Record<string, unknown>;
  if (patch.name == null) delete patch.name;
  if ("optedOut" in patch) patch.optedOut = !!patch.optedOut;
  // "Do not contact" and the opt-out flag always move together.
  if (patch.status === "Do not contact") patch.optedOut = true;
  if (patch.optedOut === true) patch.status = "Do not contact";
  const db = await getDb();
  await db
    .update(schema.contacts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.contacts.id, id));
  return { ok: true };
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const db = await getDb();
  await db.delete(schema.contacts).where(eq(schema.contacts.id, id));
  return { ok: true };
});
