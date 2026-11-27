import { eq } from "drizzle-orm";
import { HttpError, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { CALL_OUTCOMES } from "@/lib/fields";
import { today, uid } from "@/lib/util";

type CallBody = { contactId?: string; companyId?: string; phone?: string; outcome?: string; note?: string };
type Outcome = (typeof CALL_OUTCOMES)[number];

const OUTCOMES = new Set<string>(CALL_OUTCOMES);
const isOutcome = (v: unknown): v is Outcome => typeof v === "string" && OUTCOMES.has(v);

const BEFORE_CALL = new Set(["To contact", "Emailed"]);

/** A contact you reached moves on to "Called"; a wrong number leaves them where they were. */
const statusAfterCall = (status: string, outcome: Outcome) =>
  BEFORE_CALL.has(status) && outcome !== "Wrong number" ? "Called" : status;

function callRow(body: CallBody, outcome: Outcome, contactCompanyId: string | null): typeof schema.calls.$inferInsert {
  return {
    id: uid(),
    contactId: body.contactId ?? null,
    companyId: body.companyId ?? contactCompanyId,
    phone: body.phone ?? null,
    outcome,
    note: body.note?.trim() || null,
  };
}

export const POST = route(async (req: Request) => {
  const body = (await req.json()) as CallBody;
  const outcome = body.outcome;
  if (!isOutcome(outcome)) throw new HttpError(400, "Pick a call outcome.");
  const db = await getDb();
  const [contact] = body.contactId ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, body.contactId)) : [];
  await db.insert(schema.calls).values(callRow(body, outcome, contact?.companyId ?? null));
  if (contact) {
    await db
      .update(schema.contacts)
      .set({ status: statusAfterCall(contact.status, outcome), lastContacted: today(), updatedAt: new Date() })
      .where(eq(schema.contacts.id, contact.id));
  }
  return { ok: true };
});
