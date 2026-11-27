"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useRuns } from "@/components/shell";
import { Card, LinkButton, Notice, PageHeader, Stat, Tag } from "@/components/ui";
import { useLoad } from "@/lib/client";

type Today = {
  setup: { done: boolean; profile: boolean; search: boolean; apify: boolean; gmail: boolean; ai: boolean };
  name: string;
  stats: {
    jobs: number; strong: number; toReview: number; applied: number; responses: number;
    interviews: number; offers: number; responseRate: number | null;
    contacts: number; withEmail: number; withPhone: number;
  };
  attention: { kind: string; jobId: string; title: string; detail: string }[];
  schedule: { enabled: boolean; time: string };
};

const KIND: Record<string, { label: string; tone: "warn" | "good" | "bad" | "accent" }> = {
  interview: { label: "Interview", tone: "warn" },
  reply: { label: "Reply", tone: "good" },
  followup: { label: "Follow up due", tone: "bad" },
  quiet: { label: "No reply", tone: "accent" },
};

type Stats = Today["stats"];
type LastRun = NonNullable<ReturnType<typeof useRuns>["runs"]>["runs"][number];

function SetupCard({ setup }: { setup: Today["setup"] }) {
  const missing = [!setup.profile && "your CV", !setup.search && "job titles and locations", !setup.gmail && "Gmail"].filter(Boolean);
  if (!missing.length) return null;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 border-warn">
      <div>
        <b>Finish setup to start finding jobs.</b>
        <p className="text-muted">Still needed: {missing.join(", ")}.</p>
      </div>
      <LinkButton href={setup.done ? "/settings" : "/setup"} primary>
        {setup.done ? "Open Settings" : "Start setup"}
      </LinkButton>
    </Card>
  );
}

function PipelineStats({ s }: { s: Stats }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
      <Stat label="Emails to review" value={s.toReview} />
      <Stat label="Strong fits open" value={s.strong} />
      <Stat label="Applied" value={s.applied} />
      <Stat label="Responses" value={s.responses} />
      <Stat label="Interviews" value={s.interviews} />
      <Stat label="Offers" value={s.offers} />
      <Stat label="Response rate" value={s.responseRate == null ? "–" : `${s.responseRate}%`} />
    </div>
  );
}

function DoItem({ children, href, label, primary }: { children: ReactNode; href: string; label: string; primary?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{children}</span>
      <LinkButton href={href} small primary={primary}>{label}</LinkButton>
    </li>
  );
}

function DoNextCard({ s }: { s: Stats }) {
  return (
    <Card>
      <h2 className="mb-3 text-xs font-bold tracking-wider text-muted uppercase">Do next</h2>
      <ul className="grid gap-2.5">
        {s.toReview ? <DoItem href="/outbox" label="Review" primary><b>{s.toReview}</b> {s.toReview === 1 ? "email is" : "emails are"} written and waiting for your review.</DoItem> : null}
        {s.strong ? <DoItem href="/jobs" label="Open board"><b>{s.strong}</b> strong-fit {s.strong === 1 ? "job" : "jobs"} not applied to yet.</DoItem> : null}
        {s.withPhone ? <DoItem href="/leads" label="Open leads"><b>{s.withPhone}</b> {s.withPhone === 1 ? "contact has" : "contacts have"} a phone number you can call.</DoItem> : null}
        {!s.toReview && !s.strong && !s.withPhone ? (
          <li className="text-muted">Nothing waiting. Press “Find new jobs” above to look for fresh postings.</li>
        ) : null}
      </ul>
    </Card>
  );
}

const ATTENTION_SHOWN = 12;

function AttentionCard({ attention }: { attention: Today["attention"] }) {
  return (
    <Card>
      <h2 className="mb-3 text-xs font-bold tracking-wider text-muted uppercase">Needs attention</h2>
      {attention.length ? (
        <ul className="grid gap-2">
          {attention.slice(0, ATTENTION_SHOWN).map((a, i) => (
            <li key={`${a.jobId}-${i}`}>
              <Link href={`/jobs?open=${encodeURIComponent(a.jobId)}`} className="flex flex-wrap items-baseline gap-2 hover:text-accent">
                <Tag tone={KIND[a.kind]?.tone}>{KIND[a.kind]?.label ?? a.kind}</Tag>
                <b>{a.title}</b>
                <span className="text-muted">{a.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No interviews, replies or follow-ups due.</p>
      )}
    </Card>
  );
}

const RUN_STATE: Record<string, string> = { running: "in progress", failed: "stopped early" };

function LastRunCard({ lastRun }: { lastRun: LastRun | undefined }) {
  if (!lastRun?.log) return null;
  return (
    <Card>
      <h2 className="mb-2 text-xs font-bold tracking-wider text-muted uppercase">Last run · {RUN_STATE[lastRun.status] ?? "finished"}</h2>
      <pre className="max-h-56 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted">{lastRun.log}</pre>
    </Card>
  );
}

const DAILY_ON = (time: string) => `The daily run starts at ${time} while JobPilot is open. It prepares drafts and never sends email.`;
const DAILY_OFF = "The daily run is off. Use “Find new jobs” whenever you want fresh leads. It looks at the past 24 hours unless you pick a longer window.";

export default function TodayPage() {
  const { data, error, reload } = useLoad<Today>("/api/today");
  const { finishedTick, runs } = useRuns();
  useEffect(() => {
    if (finishedTick) void reload();
  }, [finishedTick, reload]);

  if (error) return <Notice title="Could not load" tone="bad">{error}</Notice>;
  if (!data) return <Notice title="Loading…" />;
  const s = data.stats;
  return (
    <>
      <PageHeader title={data.name ? `Today, ${data.name.split(" ")[0]}` : "Today"} sub={data.schedule.enabled ? DAILY_ON(data.schedule.time) : DAILY_OFF} />
      <SetupCard setup={data.setup} />
      <PipelineStats s={s} />
      <div className="grid gap-4 lg:grid-cols-2">
        <DoNextCard s={s} />
        <AttentionCard attention={data.attention} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
        <Stat label="Jobs tracked" value={s.jobs} />
        <Stat label="Contacts" value={s.contacts} />
        <Stat label="With email" value={s.withEmail} />
        <Stat label="With phone" value={s.withPhone} />
      </div>
      <LastRunCard lastRun={runs?.runs[0]} />
    </>
  );
}
