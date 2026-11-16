"use client";

import { useState } from "react";
import {
  ApplySection, ConnectionsSection, LimitsSection, ProfileSection, SearchSection, useSettings,
} from "@/components/settings/sections";
import { useRuns } from "@/components/shell";
import { Button, Card, Notice, PageHeader, Tag, useAction } from "@/components/ui";
import { useLoad } from "@/lib/client";

const TABS = ["Search", "Your CV", "Application answers", "Connections", "Limits & schedule", "Runs"] as const;

type Usage = { spend: { estimatedUsd: number; capUsd: number; account: { usedUsd: number; limitUsd: number; plan: string } | null } };

function RunsTab() {
  const { runs } = useRuns();
  const { data } = useLoad<Usage>("/api/runs?usage");
  return (
    <div className="grid gap-4">
      <Card className="grid gap-1">
        <h2 className="text-base font-bold">Apify usage this month</h2>
        <p className="text-sm text-muted">
          JobPilot’s own estimate: <b className="text-fg">${(data?.spend.estimatedUsd ?? 0).toFixed(2)}</b> of your ${(data?.spend.capUsd ?? 0).toFixed(2)} cap.
          {data?.spend.account
            ? <> Apify reports <b className="text-fg">${data.spend.account.usedUsd.toFixed(2)}</b> of ${data.spend.account.limitUsd.toFixed(2)} used on the {data.spend.account.plan} plan (includes anything you ran outside JobPilot).</>
            : " Connect Apify to see the account total."}
        </p>
      </Card>
      {(runs?.runs ?? []).map((r) => (
        <Card key={r.id} className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <b>{new Date(r.startedAt).toLocaleString()}</b>
            <Tag>{r.kind}</Tag>
            <Tag tone={r.status === "done" ? "good" : r.status === "failed" ? "bad" : "warn"}>{r.status === "failed" ? "stopped early" : r.status}</Tag>
            <span className="text-xs text-muted">
              {Object.entries(r.stats).map(([k, v]) => `${k} ${v}`).join(" · ")}
            </span>
          </div>
          {r.log ? <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted">{r.log}</pre> : null}
        </Card>
      ))}
      {runs && !runs.runs.length ? <Notice title="No runs yet">Press “Find new jobs” at the top.</Notice> : null}
    </div>
  );
}

export default function SettingsPage() {
  const state = useSettings();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Search");
  const { busy, run } = useAction();

  if (state.error) return <Notice title="Could not load settings" tone="bad">{state.error}</Notice>;
  if (!state.settings || !state.profile) return <Notice title="Loading…" />;

  const saveAll = () =>
    run("save", async () => {
      await state.save({ settings: { ...state.settings!, setupDone: true }, profile: state.profile! });
      return "Saved";
    });

  return (
    <>
      <PageHeader title="Settings" sub="Everything is stored on this computer, in the data folder of the project.">
        {tab !== "Runs" && tab !== "Connections" ? <Button variant="primary" busy={busy === "save"} onClick={saveAll}>Save changes</Button> : null}
      </PageHeader>
      <div className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t} className={"-mb-px border-b-2 px-3.5 py-2.5 text-sm font-bold " + (tab === t ? "border-accent text-fg" : "border-transparent text-muted")}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Search" ? <SearchSection state={state} /> : null}
      {tab === "Your CV" ? <ProfileSection state={state} /> : null}
      {tab === "Application answers" ? <ApplySection state={state} /> : null}
      {tab === "Connections" ? <ConnectionsSection state={state} /> : null}
      {tab === "Limits & schedule" ? <LimitsSection state={state} /> : null}
      {tab === "Runs" ? <RunsTab /> : null}
    </>
  );
}
