import { route } from "@/lib/api";
import { jobForUrl } from "@/lib/apply/context";
import { assertLocalCaller } from "@/lib/apply/guard";
import { profileIsReady } from "@/lib/cv/types";
import { getProfile } from "@/lib/settings";

const CLOSED = ["Rejected", "Skipped"];

/** Tells the extension which saved job a browser tab belongs to. */
export const GET = route(async (req: Request) => {
  assertLocalCaller(req);
  const url = new URL(req.url).searchParams.get("url") ?? "";
  const { job, matchedBy, jobs } = await jobForUrl(url);
  // A job the extension already tied to this tab, so it can be shown even if it's not in the short list.
  const pickedId = new URL(req.url).searchParams.get("id");
  const picked = pickedId ? jobs.find((j) => j.id === pickedId) : undefined;

  const brief = (j: (typeof jobs)[number]) => ({ id: j.id, company: j.company, role: j.role });
  return {
    job: job ? brief(job) : null,
    picked: picked ? brief(picked) : null,
    matchedBy,
    jobs: jobs.filter((j) => !CLOSED.includes(j.status)).slice(0, 80).map(brief),
    profileReady: profileIsReady(await getProfile()),
  };
});
