import { HttpError, route } from "@/lib/api";
import { currentRunId, recentRuns, startRun, type RunKind } from "@/lib/pipeline/run";
import { sentTodayCount } from "@/lib/pipeline/send";
import { getSettings } from "@/lib/settings";
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
  const { kind } = (await req.json()) as { kind?: RunKind };
  if (kind !== "find" && kind !== "daily" && kind !== "inbox") {
    throw new HttpError(400, "Unknown run type.");
  }
  return startRun(kind);
});
