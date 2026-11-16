import { closeStaleRuns, startRun } from "@/lib/pipeline/run";
import { getSecrets, getSettings, getState } from "@/lib/settings";
import { today } from "@/lib/util";

const g = globalThis as unknown as { __jobpilotScheduler?: boolean };

/**
 * Starts the daily run once per day, the first time the app is running at or
 * after the chosen time. It prepares jobs and drafts; it never sends email.
 */
export function startScheduler() {
  if (g.__jobpilotScheduler) return;
  g.__jobpilotScheduler = true;

  void closeStaleRuns().catch(() => {});

  const tick = async () => {
    try {
      const settings = await getSettings();
      if (!settings.setupDone || !settings.schedule.enabled) return;
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      if (hhmm < settings.schedule.time) return;
      if ((await getState<string>("lastDailyRun")) === today()) return;
      if (!(await getSecrets()).apifyToken) return;
      await startRun("daily");
    } catch (err) {
      console.error("[jobpilot] scheduler:", err);
    }
  };

  setInterval(tick, 60_000).unref();
}
