import { eq } from "drizzle-orm";
import { HttpError, pdfResponse, route, type IdParams } from "@/lib/api";
import { renderCv } from "@/lib/cv/pdf";
import { profileIsReady } from "@/lib/cv/types";
import { cvFileName } from "@/lib/cv/variant";
import { getDb, schema } from "@/lib/db";
import { getProfile } from "@/lib/settings";

/** The exact CV that will be attached to this email. */
export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const db = await getDb();
  const [item] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, id));
  if (!item) throw new HttpError(404, "Email not found.");
  const [job] = item.jobId
    ? await db.select().from(schema.jobs).where(eq(schema.jobs.id, item.jobId))
    : [];
  const profile = await getProfile();
  if (!profileIsReady(profile)) throw new HttpError(400, "Add your CV in Settings first.");
  return pdfResponse(
    await renderCv(profile, item.cvVariant ?? job?.cvVariant),
    cvFileName(profile, job?.role, job?.company),
    true,
  );
});
