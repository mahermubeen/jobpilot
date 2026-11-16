import { HttpError, route, type IdParams } from "@/lib/api";
import { sendOutboxItem } from "@/lib/pipeline/send";

/** Sends one email. Only ever called from a click on Send in the Outbox. */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { confirmGuessed?: boolean };
  const result = await sendOutboxItem(id, { confirmGuessed: !!body.confirmGuessed });
  if (!result.ok) {
    throw new HttpError(result.needsConfirm ? 409 : 400, result.reason, {
      needsConfirm: !!result.needsConfirm,
    });
  }
  return { ok: true };
});
