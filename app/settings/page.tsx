"use client";

import { type ReactNode, useState } from "react";
import {
  ApplySection, ConnectionsSection, LimitsSection, ProfileSection, SearchSection, useSettings,
} from "@/components/settings/sections";
import { useRuns } from "@/components/shell";
import { Button, Card, Notice, PageHeader, Tag, useAction } from "@/components/ui";
import { useLoad } from "@/lib/client";

const TABS = ["Search", "Your CV", "Application answers", "Connections", "Limits & schedule", "Runs"] as const;

type Usage = { spend: { estimatedUsd: number; capUsd: number; account: { usedUsd: number; limitUsd: number; plan: string } | null } };

type RunRow = NonNullable<ReturnType<typeof useRuns>["runs"]>["runs"][number];
const money = (n: number | undefined) => `$${(n ?? 0).toFixed(2)}`;
const RUN_TONE: Record<string, "good" | "bad"> = { done: "good", failed: "bad" };

function SpendCard({ spend }: { spend: Usage["spend"] | undefined }) {
  const account = spend?.account;
  return (
    <Card className="grid gap-1">
      <h2 className="text-base font-bold">Apify usage this month</h2>
      <p className="text-sm text-muted">
        JobPilot’s own estimate: <b className="text-fg">{money(spend?.estimatedUsd)}</b> of your {money(spend?.capUsd)} cap.
        {account
          ? <> Apify reports <b className="text-fg">{money(account.usedUsd)}</b> of {money(account.limitUsd)} used on the {account.plan} plan (includes anything you ran outside JobPilot).</>
          : " Connect Apify to see the account total."}
      </p>
    </Card>
  );
}

function RunCard({ r }: { r: RunRow }) {
  return (
    <Card className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <b>{new Date(r.startedAt).toLocaleString()}</b>
        <Tag>{r.kind}</Tag>
        <Tag tone={RUN_TONE[r.status] ?? "warn"}>{r.status === "failed" ? "stopped early" : r.status}</Tag>
        <span className="text-xs text-muted">
          {Object.entries(r.stats).map(([k, v]) => `${k} ${v}`).join(" · ")}
        </span>
      </div>
      {r.log ? <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted">{r.log}</pre> : null}
    </Card>
  );
}

function RunsTab() {
  const { runs } = useRuns();
  const { data } = useLoad<Usage>("/api/runs?usage");
  return (
    <div className="grid gap-4">
      <SpendCard spend={data?.spend} />
      {(runs?.runs ?? []).map((r) => <RunCard key={r.id} r={r} />)}
      {runs && !runs.runs.length ? <Notice title="No runs yet">Press “Find new jobs” at the top.</Notice> : null}
    </div>
  );
}

type TabName = (typeof TABS)[number];
type State = ReturnType<typeof useSettings>;

const TAB_VIEWS: Record<TabName, (state: State) => ReactNode> = {
  Search: (state) => <SearchSection state={state} />,
  "Your CV": (state) => <ProfileSection state={state} />,
  "Application answers": (state) => <ApplySection state={state} />,
  Connections: (state) => <ConnectionsSection state={state} />,
  "Limits & schedule": (state) => <LimitsSection state={state} />,
  Runs: () => <RunsTab />,
};
/** Tabs that save themselves, so the page-wide Save button is hidden there. */
const SELF_SAVING = new Set<TabName>(["Runs", "Connections"]);
/** ?tab=answers opens "Application answers" (the extension links there to show what it saved). */
const LINKED_TABS: Record<string, TabName> = { answers: "Application answers", connections: "Connections" };

function initialTab(): TabName {
  const want = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
  return (want && LINKED_TABS[want]) || "Search";
}

function TabBar({ tab, setTab }: { tab: TabName; setTab: (t: TabName) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line">
      {TABS.map((t) => (
        <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t} className={"-mb-px border-b-2 px-3.5 py-2.5 text-sm font-bold " + (tab === t ? "border-accent text-fg" : "border-transparent text-muted")}>
          {t}
        </button>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const state = useSettings();
  const [tab, setTab] = useState<TabName>(initialTab);
  const { busy, run } = useAction();

  if (state.error) return <Notice title="Could not load settings" tone="bad">{state.error}</Notice>;
  const { settings, profile } = state;
  if (!settings || !profile) return <Notice title="Loading…" />;

  const saveAll = () =>
    run("save", async () => {
      await state.save({ settings: { ...settings, setupDone: true }, profile });
      return "Saved";
    });

  return (
    <>
      <PageHeader title="Settings" sub="Everything is stored on this computer, in the data folder of the project.">
        {SELF_SAVING.has(tab) ? null : <Button variant="primary" busy={busy === "save"} onClick={saveAll}>Save changes</Button>}
      </PageHeader>
      <TabBar tab={tab} setTab={setTab} />
      {TAB_VIEWS[tab](state)}
    </>
  );
}
