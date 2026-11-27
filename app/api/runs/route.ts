import { HttpError, route } from "@/lib/api";
import { currentRunId, recentRuns, startRun, type RunKind } from "@/lib/pipeline/run";
import { sentTodayCount } from "@/lib/pipeline/send";
import { getSettings } from "@/lib/settings";
import { isPostedWithin, type PostedWithin } from "@/lib/sources/posted";
import { accountUsage, monthSpendUsd } from "@/lib/sources/apify";

export const GET = route(async (req: Request) => {
  const withUsage = new URL(req.url).searchParams.has("usage");
  const [runs, settings, spent, sentToday, account] = await Promise.all([
    recentRuns(),
    getSettings(),
    monthSpendUsd(),
    sentTodayCount(),
    withUsage ? accountUsage() : Promise.resolve(null),
  ]);
  return {
    running: currentRunId(),
    runs,
    spend: { estimatedUsd: spent, capUsd: settings.caps.apifyMonthlyUsd, account },
    sentToday,
    dailyCap: settings.caps.dailySend,
  };
});

export const POST = route(async (req: Request) => {
  const { kind, postedWithinDays = 1 } = (await req.json()) as {
    kind?: RunKind;
    postedWithinDays?: PostedWithin;
  };
  if (kind !== "find" && kind !== "daily" && kind !== "inbox") {
    throw new HttpError(400, "Unknown run type.");
  }
  if (!isPostedWithin(postedWithinDays)) {
    throw new HttpError(400, "Posted within must be 1, 3 or 7 days.");
  }
  return startRun(kind, postedWithinDays);
});
