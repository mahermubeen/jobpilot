import { pdfResponse, HttpError, route } from "@/lib/api";
import { assertLocalCaller } from "@/lib/apply/guard";
import { renderCv } from "@/lib/cv/pdf";
import { profileIsReady } from "@/lib/cv/types";
import { cvFileName } from "@/lib/cv/variant";
import { getProfile } from "@/lib/settings";

/**
 * Your standard CV, for an application page that is not one of the saved
 * jobs: `?role=&company=` name the file only.
 */
export const GET = route(async (req: Request) => {
  assertLocalCaller(req);
  const profile = await getProfile();
  if (!profileIsReady(profile)) throw new HttpError(400, "Add your CV in Settings first.");
  const q = new URL(req.url).searchParams;
  const role = (q.get("role") ?? "").slice(0, 120) || undefined;
  const company = (q.get("company") ?? "").slice(0, 80) || undefined;
  return pdfResponse(await renderCv(profile, null), cvFileName(profile, role, company), false);
});
