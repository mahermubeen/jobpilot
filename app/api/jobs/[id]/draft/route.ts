import { eq } from "drizzle-orm";
import { HttpError, route, type IdParams } from "@/lib/api";
import { profileIsReady } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import { draftForJob } from "@/lib/pipeline/steps";
import { getProfile } from "@/lib/settings";

/** Writes (or rewrites) the email and CV selection for one job. */
export const POST = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
  if (!job) throw new HttpError(404, "Job not found.");
  const profile = await getProfile();
  if (!profileIsReady(profile)) throw new HttpError(400, "Add your CV in Settings first.");
  // An explicit request replaces the old draft, including the cover letter.
  const result = await draftForJob({ ...job, cover: null }, profile);
  return { ok: true, ...result };
});
