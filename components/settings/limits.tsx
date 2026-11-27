"use client";

import { Card, Check, Input, Label, Textarea } from "@/components/ui";
import type { AppSettings } from "@/lib/settings";
import { H, P } from "./bits";
import type { SettingsState } from "./state";

export function LimitsSection({ state }: { state: SettingsState }) {
  const { settings, setSettings } = state;
  if (!settings) return null;
  const caps = settings.caps;
  const setCap = (k: keyof AppSettings["caps"]) => (e: { target: { value: string } }) =>
    setSettings({ ...settings, caps: { ...caps, [k]: Math.max(0, Number(e.target.value) || 0) } });

  return (
    <div className="grid gap-4">
      <Card className="grid gap-3">
        <H>Safety limits</H>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label label="Emails per day" hint="Sending stops for the day at this number."><Input type="number" min={1} max={100} value={caps.dailySend} onChange={setCap("dailySend")} /></Label>
          <Label label="Apify spend per month (USD)" hint="Runs are refused once the estimate reaches this. The free plan gives about $5."><Input type="number" min={0} step={0.5} value={caps.apifyMonthlyUsd} onChange={setCap("apifyMonthlyUsd")} /></Label>
          <Label label="Companies looked up per run" hint="About $0.01 each."><Input type="number" min={0} max={50} value={caps.enrichPerRun} onChange={setCap("enrichPerRun")} /></Label>
          <Label label="Applications written per run"><Input type="number" min={0} max={50} value={caps.draftPerRun} onChange={setCap("draftPerRun")} /></Label>
        </div>
      </Card>

      <Card className="grid gap-3">
        <H>Daily run</H>
        <P>Once a day, while JobPilot is running, it looks for jobs posted in the last 24 hours, scores them, looks up contacts and writes drafts. It never sends email.</P>
        <div className="flex flex-wrap items-end gap-4">
          <Check label="Run every day" checked={settings.schedule.enabled} onChange={(e) => setSettings({ ...settings, schedule: { ...settings.schedule, enabled: e.target.checked } })} />
          <Label label="Not before"><Input type="time" value={settings.schedule.time} onChange={(e) => setSettings({ ...settings, schedule: { ...settings.schedule, time: e.target.value || "08:00" } })} /></Label>
          <Label label="Follow up after (days)"><Input type="number" min={2} max={30} value={settings.outreach.followUpDays} onChange={(e) => setSettings({ ...settings, outreach: { ...settings.outreach, followUpDays: Math.max(2, Number(e.target.value) || 5) } })} /></Label>
        </div>
      </Card>

      <Card className="grid gap-3">
        <H>Call script</H>
        <P>Shown when you press Call. Placeholders: {"{contact}"}, {"{me}"}, {"{company}"}, {"{role}"}, {"{pitch}"}.</P>
        <Textarea className="min-h-40" value={settings.outreach.callScript} onChange={(e) => setSettings({ ...settings, outreach: { ...settings.outreach, callScript: e.target.value } })} />
      </Card>
    </div>
  );
}
