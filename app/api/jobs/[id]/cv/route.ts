import { eq } from "drizzle-orm";
import { HttpError, pdfResponse, route, type IdParams } from "@/lib/api";
import { renderCv } from "@/lib/cv/pdf";
import { profileIsReady } from "@/lib/cv/types";
import { cvFileName } from "@/lib/cv/variant";
import { getDb, schema } from "@/lib/db";
import { getProfile } from "@/lib/settings";

export const GET = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
  if (!job) throw new HttpError(404, "Job not found.");
  const profile = await getProfile();
  if (!profileIsReady(profile)) throw new HttpError(400, "Add your CV in Settings first.");
  const inline = new URL(req.url).searchParams.has("inline");
  return pdfResponse(
    await renderCv(profile, job.cvVariant),
    cvFileName(profile, job.role, job.company),
    inline,
  );
});
