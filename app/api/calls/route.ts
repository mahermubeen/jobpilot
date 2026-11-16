import { eq } from "drizzle-orm";
import { HttpError, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { CALL_OUTCOMES } from "@/lib/fields";
import { today, uid } from "@/lib/util";

export const POST = route(async (req: Request) => {
  const body = (await req.json()) as {
    contactId?: string;
    companyId?: string;
    phone?: string;
    outcome?: string;
    note?: string;
  };
  if (!body.outcome || !(CALL_OUTCOMES as readonly string[]).includes(body.outcome)) {
    throw new HttpError(400, "Pick a call outcome.");
  }
  const db = await getDb();
  const [contact] = body.contactId
    ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, body.contactId))
    : [];
  await db.insert(schema.calls).values({
    id: uid(),
    contactId: body.contactId ?? null,
    companyId: body.companyId ?? contact?.companyId ?? null,
    phone: body.phone ?? null,
    outcome: body.outcome,
    note: body.note?.trim() || null,
  });
  if (contact) {
    const moved =
      ["To contact", "Emailed"].includes(contact.status) && body.outcome !== "Wrong number";
    await db
      .update(schema.contacts)
      .set({
        status: moved ? "Called" : contact.status,
        lastContacted: today(),
        updatedAt: new Date(),
      })
      .where(eq(schema.contacts.id, contact.id));
  }
  return { ok: true };
});
