"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRuns } from "@/components/shell";
import {
  Button, Card, Drawer, fitTone, Input, Label, Notice, PageHeader, Tag, Textarea, useAction,
} from "@/components/ui";
import { api, ApiError, fmtDate, jobLink, useLoad } from "@/lib/client";

type Item = {
  id: string; to: string; subject: string; body: string; status: string; error: string | null;
  followUpOf: string | null; sentAt: string | null; repliedAt: string | null; createdAt: string;
  job?: { id: string; company: string; role: string; link: string | null; fit: string | null };
  contact?: { id: string; name: string; title: string | null; emailStatus: string | null; optedOut: boolean };
};
type Outbox = { items: Item[]; sentToday: number; dailyCap: number };
type Draft = { to: string; subject: string; body: string };
type Tab = "review" | "sent";
type Run = ReturnType<typeof useAction>["run"];

const WAITING = ["queued", "approved", "failed", "sending"];
const plural = (n: number) => (n === 1 ? "email" : "emails");
const titleOf = (i: Item) => (i.job ? `${i.job.company} · ${i.job.role}` : i.to);

/** Sends one email; asks once more when the address is only a guess. */
async function sendOne(id: string): Promise<void> {
  try {
    await api(`/api/outbox/${id}/send`, { method: "POST", body: {} });
  } catch (e) {
    if (e instanceof ApiError && e.data.needsConfirm && window.confirm(`${e.message}`)) {
      await api(`/api/outbox/${id}/send`, { method: "POST", body: { confirmGuessed: true } });
      return;
    }
    throw e;
  }
}

/** Sends the batch one at a time, reporting progress, and returns the summary line. */
async function sendBatch(batch: Item[], progress: (s: string) => void): Promise<string> {
  let ok = 0;
  const failures: string[] = [];
  for (const [n, item] of batch.entries()) {
    progress(`Sending ${n + 1} of ${batch.length}…`);
    try {
      // eslint-disable-next-line no-await-in-loop -- one Gmail send at a time: keeps under Gmail's rate limit and lets each guessed address be confirmed in turn
      await sendOne(item.id);
      ok++;
    } catch (e) {
      failures.push(`${item.to}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return failures.length ? `Sent ${ok}. Not sent: ${failures.join(" | ")}` : `Sent ${ok} ${plural(ok)}.`;
}

const isDirty = (open: Item | null, d: Draft) =>
  !!open && (d.to !== open.to || d.subject !== open.subject || d.body !== open.body);

function StatusTags({ i }: { i: Item }) {
  const status: Record<string, ReactNode> = {
    approved: <Tag tone="good">Approved</Tag>,
    failed: <Tag tone="bad">Failed</Tag>,
    sending: <Tag tone="warn">Sending</Tag>,
  };
  return (
    <>
      {status[i.status] ?? null}
      {i.followUpOf ? <Tag tone="accent">Follow-up</Tag> : null}
      {i.repliedAt ? <Tag tone="good">Replied {fmtDate(i.repliedAt)}</Tag> : null}
      {i.job ? <Tag tone={fitTone(i.job.fit)}>{i.job.fit ?? "Not scored"}</Tag> : null}
    </>
  );
}

function Recipient({ i }: { i: Item }) {
  return (
    <span className="text-xs text-muted">
      To {i.contact ? `${i.contact.name} · ` : ""}<span className="font-mono">{i.to}</span>
      {i.contact?.emailStatus ? ` (${i.contact.emailStatus})` : ""}
      {i.sentAt ? ` · sent ${fmtDate(i.sentAt)}` : ""}
    </span>
  );
}

type CardActions = { show: (i: Item) => void; approve: (i: Item) => void; busy: string | null };

function ItemCard({ i, review, actions }: { i: Item; review: boolean; actions: CardActions }) {
  const canApprove = i.status === "queued" || i.status === "failed";
  return (
    <Card className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
      <button type="button" onClick={() => actions.show(i)} className="grid gap-1 text-left">
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusTags i={i} />
          <b>{titleOf(i)}</b>
        </span>
        <span className="font-semibold">{i.subject}</span>
        <Recipient i={i} />
        {i.error ? <span className="text-xs text-bad">{i.error}</span> : null}
        <span className="line-clamp-2 text-sm text-muted">{i.body}</span>
      </button>
      {review ? (
        <div className="flex gap-1.5 sm:flex-col">
          <Button small onClick={() => actions.show(i)}>Review</Button>
          {canApprove ? (
            <Button small busy={actions.busy === `approve-${i.id}`} onClick={() => actions.approve(i)}>Approve</Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Tabs({ tab, setTab, counts }: { tab: Tab; setTab: (t: Tab) => void; counts: Record<Tab, number> }) {
  const label = (t: Tab) => (t === "review" ? `To review (${counts.review})` : `Sent (${counts.sent})`);
  return (
    <div className="flex gap-1 border-b border-line">
      {(["review", "sent"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => setTab(t)}
          aria-pressed={tab === t}
          className={"-mb-px border-b-2 px-3.5 py-2.5 text-sm font-bold " + (tab === t ? "border-accent text-fg" : "border-transparent text-muted")}
        >
          {label(t)}
        </button>
      ))}
    </div>
  );
}

const EMPTY: Record<Tab, { title: string; text: string }> = {
  review: {
    title: "Nothing waiting for review",
    text: "Emails appear here after a run finds a strong-fit job with someone to write to, or when you press ✉ Email on a lead.",
  },
  sent: { title: "Nothing sent yet", text: "Sent emails and their replies show up here." },
};

function ItemList({ loaded, list, tab, actions }: { loaded: boolean; list: Item[]; tab: Tab; actions: CardActions }) {
  if (!loaded) return <Notice title="Loading…" />;
  if (!list.length) return <Notice title={EMPTY[tab].title}>{EMPTY[tab].text}</Notice>;
  return (
    <div className="grid gap-2.5">
      {list.map((i) => <ItemCard key={i.id} i={i} review={tab === "review"} actions={actions} />)}
    </div>
  );
}

function Warnings({ open }: { open: Item }) {
  return (
    <>
      {open.contact?.optedOut ? <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">This contact asked not to be contacted. Sending is blocked.</div> : null}
      {open.contact?.emailStatus === "guessed" ? <div className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">This address is a guess and may bounce.</div> : null}
      {open.error ? <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{open.error}</div> : null}
    </>
  );
}

function CvPreview({ open }: { open: Item }) {
  if (open.followUpOf) {
    return <p className="text-xs text-muted">Follow-ups go in the same thread as the first email, without the CV attached again.</p>;
  }
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted">Attached CV (tailored to this job)</span>
        <a href={`/api/outbox/${open.id}/cv`} target="_blank" rel="noopener" className="text-xs font-semibold text-accent hover:underline">Open in new tab ↗</a>
      </div>
      <iframe title="CV preview" src={`/api/outbox/${open.id}/cv#toolbar=0`} className="h-[520px] w-full rounded-lg border border-line bg-white" />
    </div>
  );
}

function EmailEditor({ open, draft, setDraft }: { open: Item; draft: Draft; setDraft: (f: (d: Draft) => Draft) => void }) {
  const locked = open.status === "sent";
  const field = (k: keyof Draft) => ({
    value: draft[k],
    disabled: locked,
    onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value })),
  });
  const words = draft.body.trim().split(/\s+/).filter(Boolean).length;
  return (
    <>
      <Warnings open={open} />
      <Label label="To"><Input type="email" {...field("to")} /></Label>
      <Label label="Subject"><Input {...field("subject")} /></Label>
      <Label label={`Message · ${words} words`}><Textarea className="min-h-72" {...field("body")} /></Label>
      <CvPreview open={open} />
      {open.job?.link ? <a href={jobLink(open.job.link, open.job.id)} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent hover:underline">Open the job listing ↗</a> : null}
    </>
  );
}

type FooterProps = {
  open: Item | null; dirty: boolean; left: number; busy: string | null;
  close: () => void; discard: (i: Item) => void; approve: () => void; send: () => void;
};

function DrawerFooter({ open, dirty, left, busy, close, discard, approve, send }: FooterProps) {
  if (!open || open.status === "sent") return <><span className="flex-1" /><Button onClick={close}>Close</Button></>;
  return (
    <>
      <Button variant="danger" onClick={() => discard(open)}>Discard</Button>
      <span className="flex-1" />
      <Button busy={busy === "approve"} onClick={approve}>{dirty ? "Save & approve" : "Approve"}</Button>
      <Button variant="primary" busy={busy === "send"} onClick={send} disabled={!left || open.status === "sending"}>Send now</Button>
    </>
  );
}

/** The open email, its edits and the drawer actions. */
function useOpenEmail({ run, reload }: { run: Run; reload: () => Promise<unknown> }) {
  const [open, setOpen] = useState<Item | null>(null);
  const [draft, setDraft] = useState<Draft>({ to: "", subject: "", body: "" });
  const dirty = isDirty(open, draft);
  const show = (i: Item) => {
    setOpen(i);
    setDraft({ to: i.to, subject: i.subject, body: i.body });
  };
  const close = () => setOpen(null);
  const saveEdits = async (status?: string) => {
    if (!open) return;
    await api(`/api/outbox/${open.id}`, { method: "PATCH", body: { ...draft, ...(status ? { status } : {}) } });
  };
  const send = () =>
    run("send", async () => {
      if (!open) return;
      if (dirty) await saveEdits();
      try {
        await sendOne(open.id);
      } finally {
        await reload();
      }
      close();
      return `Sent to ${draft.to}`;
    });
  const approve = () => run("approve", async () => { await saveEdits("approved"); await reload(); close(); return "Approved"; });
  const discard = (i: Item) => {
    if (!window.confirm("Discard this email?")) return;
    void run("discard", async () => { await api(`/api/outbox/${i.id}`, { method: "DELETE" }); await reload(); close(); return "Discarded"; });
  };
  return { open, draft, setDraft, dirty, show, close, send, approve, discard };
}

function useOutboxItems(data: Outbox | null) {
  return useMemo(() => {
    const items = data?.items ?? [];
    const waiting = items.filter((i) => WAITING.includes(i.status));
    return {
      waiting,
      sent: items.filter((i) => i.status === "sent"),
      approved: waiting.filter((i) => i.status === "approved"),
      left: data ? Math.max(0, data.dailyCap - data.sentToday) : 0,
    };
  }, [data]);
}

/** Sends every approved email that fits under today's cap, after one confirm. */
function useBulkSend({ approved, left, reload }: { approved: Item[]; left: number; reload: () => Promise<unknown> }) {
  const [bulk, setBulk] = useState<string | null>(null);
  const sendApproved = async () => {
    const batch = approved.slice(0, left);
    if (!batch.length || !window.confirm(`Send ${batch.length} approved ${plural(batch.length)} now from your Gmail?`)) return;
    const summary = await sendBatch(batch, setBulk);
    await reload();
    setBulk(summary);
  };
  return { bulk, sendApproved };
}

function Header({ data, approved, left, busy, sendApproved }: {
  data: Outbox | null; approved: number; left: number; busy: string | null; sendApproved: () => void;
}) {
  return (
    <PageHeader title="Outbox" sub="Every email waits here until you send it. Nothing leaves your Gmail on its own.">
      <span className="text-xs text-muted">{data ? `${data.sentToday} of ${data.dailyCap} sent today` : ""}</span>
      <Button variant="primary" onClick={sendApproved} disabled={!approved || !left || !!busy}>
        Send {approved || ""} approved
      </Button>
    </PageHeader>
  );
}

export default function OutboxPage() {
  const { data, error, reload } = useLoad<Outbox>("/api/outbox");
  const { finishedTick } = useRuns();
  const { busy, run } = useAction();
  const [tab, setTab] = useState<Tab>("review");
  const { waiting, sent, approved, left } = useOutboxItems(data);
  const { bulk, sendApproved } = useBulkSend({ approved, left, reload });
  const email = useOpenEmail({ run, reload });

  useEffect(() => {
    if (finishedTick) void reload();
  }, [finishedTick, reload]);

  const approveOne = (i: Item) =>
    run(`approve-${i.id}`, async () => { await api(`/api/outbox/${i.id}`, { method: "PATCH", body: { status: "approved" } }); await reload(); });

  if (error) return <Notice title="Could not load the Outbox" tone="bad">{error}</Notice>;
  const { open } = email;

  return (
    <>
      <Header data={data} approved={approved.length} left={left} busy={busy} sendApproved={sendApproved} />
      {bulk ? <Card className="text-sm font-semibold">{bulk}</Card> : null}
      <Tabs tab={tab} setTab={setTab} counts={{ review: waiting.length, sent: sent.length }} />
      <ItemList loaded={!!data} list={tab === "review" ? waiting : sent} tab={tab} actions={{ show: email.show, approve: approveOne, busy }} />
      <Drawer title={open?.job ? titleOf(open) : "Email"} open={!!open} onClose={email.close} wide footer={<DrawerFooter {...email} left={left} busy={busy} />}>
        {open ? <EmailEditor open={open} draft={email.draft} setDraft={email.setDraft} /> : null}
      </Drawer>
    </>
  );
}
