"use client";

import Link from "next/link";
import { useEffect } from "react";
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

export default function TodayPage() {
  const { data, error, reload } = useLoad<Today>("/api/today");
  const { finishedTick, runs } = useRuns();
  useEffect(() => {
    if (finishedTick) void reload();
  }, [finishedTick, reload]);

  if (error) return <Notice title="Could not load" tone="bad">{error}</Notice>;
  if (!data) return <Notice title="Loading…" />;

  const s = data.stats;
  const missing = [
    !data.setup.profile && "your CV",
    !data.setup.search && "job titles and locations",
    !data.setup.apify && "an Apify token",
    !data.setup.gmail && "Gmail",
  ].filter(Boolean);
  const lastRun = runs?.runs[0];

  return (
    <>
      <PageHeader
        title={data.name ? `Today, ${data.name.split(" ")[0]}` : "Today"}
        sub={
          data.schedule.enabled
            ? `The daily run starts at ${data.schedule.time} while JobPilot is open. It prepares drafts and never sends email.`
            : "The daily run is off. Use “Find new jobs” whenever you want fresh leads."
        }
      />

      {missing.length ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warn">
          <div>
            <b>Finish setup to start finding jobs.</b>
            <p className="text-muted">Still needed: {missing.join(", ")}.</p>
          </div>
          <LinkButton href={data.setup.done ? "/settings" : "/setup"} primary>
            {data.setup.done ? "Open Settings" : "Start setup"}
          </LinkButton>
        </Card>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
        <Stat label="Emails to review" value={s.toReview} />
        <Stat label="Strong fits open" value={s.strong} />
        <Stat label="Applied" value={s.applied} />
        <Stat label="Responses" value={s.responses} />
        <Stat label="Interviews" value={s.interviews} />
        <Stat label="Offers" value={s.offers} />
        <Stat label="Response rate" value={s.responseRate == null ? "–" : `${s.responseRate}%`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-xs font-bold tracking-wider text-muted uppercase">Do next</h2>
          <ul className="grid gap-2.5">
            {s.toReview ? (
              <li className="flex items-center justify-between gap-3">
                <span><b>{s.toReview}</b> {s.toReview === 1 ? "email is" : "emails are"} written and waiting for your review.</span>
                <LinkButton href="/outbox" small primary>Review</LinkButton>
              </li>
            ) : null}
            {s.strong ? (
              <li className="flex items-center justify-between gap-3">
                <span><b>{s.strong}</b> strong-fit {s.strong === 1 ? "job" : "jobs"} not applied to yet.</span>
                <LinkButton href="/jobs" small>Open board</LinkButton>
              </li>
            ) : null}
            {s.withPhone ? (
              <li className="flex items-center justify-between gap-3">
                <span><b>{s.withPhone}</b> {s.withPhone === 1 ? "contact has" : "contacts have"} a phone number you can call.</span>
                <LinkButton href="/leads" small>Open leads</LinkButton>
              </li>
            ) : null}
            {!s.toReview && !s.strong && !s.withPhone ? (
              <li className="text-muted">Nothing waiting. Press “Find new jobs” above to look for fresh postings.</li>
            ) : null}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-3 text-xs font-bold tracking-wider text-muted uppercase">Needs attention</h2>
          {data.attention.length ? (
            <ul className="grid gap-2">
              {data.attention.slice(0, 12).map((a, i) => (
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
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
        <Stat label="Jobs tracked" value={s.jobs} />
        <Stat label="Contacts" value={s.contacts} />
        <Stat label="With email" value={s.withEmail} />
        <Stat label="With phone" value={s.withPhone} />
      </div>

      {lastRun?.log ? (
        <Card>
          <h2 className="mb-2 text-xs font-bold tracking-wider text-muted uppercase">
            Last run · {lastRun.status === "running" ? "in progress" : lastRun.status === "failed" ? "stopped early" : "finished"}
          </h2>
          <pre className="max-h-56 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted">{lastRun.log}</pre>
        </Card>
      ) : null}
    </>
  );
}
