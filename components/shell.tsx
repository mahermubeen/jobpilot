"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { api, useLoad } from "@/lib/client";
import { POSTED_WITHIN, type PostedWithin } from "@/lib/sources/posted";
import { Button, Select, Spinner, ToastProvider, useAction } from "./ui";

type RunsData = {
  running: string | null;
  runs: { id: string; kind: string; status: string; step: string | null; log: string; stats: Record<string, number>; startedAt: string; finishedAt: string | null }[];
  spend: { estimatedUsd: number; capUsd: number };
  sentToday: number;
  dailyCap: number;
};

const NAV = [
  { href: "/", label: "Today" },
  { href: "/jobs", label: "Jobs" },
  { href: "/leads", label: "Leads" },
  { href: "/outbox", label: "Outbox" },
  { href: "/settings", label: "Settings" },
];

/** Pages subscribe to this to refresh when a background run finishes. */
const RunContext = createContext<{ runs: RunsData | null; finishedTick: number }>({ runs: null, finishedTick: 0 });
export const useRuns = () => useContext(RunContext);

type Run = RunsData["runs"][number];

const runTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function lastRunNote(last: Run): string {
  if (last.status === "failed") return " · stopped early";
  return last.stats.new != null ? ` · ${last.stats.new} new jobs` : "";
}

/** What is running now, or how the last run went. */
function RunStatus({ current, last }: { current: Run | undefined; last: Run | undefined }) {
  if (current) {
    return (
      <span className="inline-flex items-center gap-2 font-semibold text-fg">
        <Spinner /> {current.step ?? "Working"}…
      </span>
    );
  }
  if (!last) return null;
  return (
    <span title={last.log}>
      Last run {runTime(last.startedAt)}
      {lastRunNote(last)}
    </span>
  );
}

function RunButtons({ running, reload }: { running: boolean; reload: () => void }) {
  const { busy, run } = useAction();
  const [postedWithinDays, setPostedWithinDays] = useState<PostedWithin>(1);
  const start = (kind: "find" | "inbox") =>
    run(kind, async () => {
      const r = await api<{ started: boolean }>("/api/runs", { body: kind === "find" ? { kind, postedWithinDays } : { kind } });
      reload();
      return r.started ? undefined : "A run is already in progress.";
    });
  return (
    <span className="ml-auto flex flex-wrap gap-2">
      <Button small onClick={() => start("inbox")} disabled={running} busy={busy === "inbox"}>
        Check replies
      </Button>
      <Select aria-label="Find jobs posted within" className="w-auto py-1 text-xs" value={postedWithinDays} onChange={(e) => setPostedWithinDays(Number(e.target.value) as PostedWithin)} disabled={running}>
        {POSTED_WITHIN.map((w) => (
          <option key={w.days} value={w.days}>{w.label}</option>
        ))}
      </Select>
      <Button small variant="primary" onClick={() => start("find")} disabled={running} busy={busy === "find"}>
        Find new jobs
      </Button>
    </span>
  );
}

function RunBar({ runs, reload }: { runs: RunsData | null; reload: () => void }) {
  const current = runs?.runs.find((r) => r.id === runs.running);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
      <RunStatus current={current} last={runs?.runs[0]} />
      {runs ? (
        <span>
          Apify ${runs.spend.estimatedUsd.toFixed(2)} / ${runs.spend.capUsd.toFixed(2)} · {runs.sentToday}/{runs.dailyCap} emails today
        </span>
      ) : null}
      <RunButtons running={!!current} reload={reload} />
    </div>
  );
}

function Nav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-wrap gap-1">
      {NAV.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
            className={"rounded-lg px-3 py-1.5 text-sm font-bold " + (active ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Counts finished runs so pages can refresh their data when one ends. */
function useFinishedTick(running: string | null) {
  const [prevRunning, setPrevRunning] = useState<string | null>(null);
  const [finishedTick, setFinishedTick] = useState(0);
  if (running !== prevRunning) {
    setPrevRunning(running);
    if (prevRunning && !running) setFinishedTick((t) => t + 1);
  }
  return finishedTick;
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: runs, reload } = useLoad<RunsData>("/api/runs", 4000);
  const finishedTick = useFinishedTick(runs?.running ?? null);
  return (
    <ToastProvider>
      <RunContext.Provider value={{ runs, finishedTick }}>
        <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-4 px-4 pt-4 pb-12">
          {pathname.startsWith("/setup") ? null : (
            <div className="grid gap-3 rounded-xl border border-line bg-surface px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <Link href="/" className="text-base font-extrabold tracking-tight">
                  JobPilot
                </Link>
                <Nav pathname={pathname} />
              </div>
              <RunBar runs={runs} reload={reload} />
            </div>
          )}
          <main className="grid grid-cols-[minmax(0,1fr)] gap-4">{children}</main>
        </div>
      </RunContext.Provider>
    </ToastProvider>
  );
}
