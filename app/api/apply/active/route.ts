import { HttpError, route } from "@/lib/api";
import { assertLocalCaller } from "@/lib/apply/guard";
import { setState } from "@/lib/settings";

/** Remembers which job the user just opened, so the extension can find it. */
export const POST = route(async (req: Request) => {
  assertLocalCaller(req);
  const { jobId } = (await req.json()) as { jobId?: string };
  if (!jobId || typeof jobId !== "string") throw new HttpError(400, "jobId is required.");
  await setState("applyActive", { jobId, at: Date.now() });
  return { ok: true };
});
