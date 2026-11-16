"use client";

import { useEffect, useMemo, useState } from "react";
import { useRuns } from "@/components/shell";
import {
  Button, Card, Drawer, fitTone, Input, Label, Notice, PageHeader, Tag, Textarea, useAction,
} from "@/components/ui";
import { api, ApiError, fmtDate, useLoad } from "@/lib/client";

type Item = {
  id: string; to: string; subject: string; body: string; status: string; error: string | null;
  followUpOf: string | null; sentAt: string | null; repliedAt: string | null; createdAt: string;
  job?: { id: string; company: string; role: string; link: string | null; fit: string | null };
  contact?: { id: string; name: string; title: string | null; emailStatus: string | null; optedOut: boolean };
};
type Outbox = { items: Item[]; sentToday: number; dailyCap: number };

const WAITING = ["queued", "approved", "failed", "sending"];

export default function OutboxPage() {
  const { data, error, reload } = useLoad<Outbox>("/api/outbox");
  const { finishedTick } = useRuns();
  const { busy, run } = useAction();
  const [tab, setTab] = useState<"review" | "sent">("review");
  const [open, setOpen] = useState<Item | null>(null);
  const [draft, setDraft] = useState({ to: "", subject: "", body: "" });
  const [bulk, setBulk] = useState<string | null>(null);

  useEffect(() => {
    if (finishedTick) void reload();
  }, [finishedTick, reload]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const waiting = items.filter((i) => WAITING.includes(i.status));
  const sent = items.filter((i) => i.status === "sent");
  const approved = waiting.filter((i) => i.status === "approved");
  const left = data ? Math.max(0, data.dailyCap - data.sentToday) : 0;

  const show = (i: Item) => {
    setOpen(i);
    setDraft({ to: i.to, subject: i.subject, body: i.body });
  };
  const dirty = open ? draft.to !== open.to || draft.subject !== open.subject || draft.body !== open.body : false;

  const saveEdits = async (status?: string) => {
    if (!open) return;
    await api(`/api/outbox/${open.id}`, { method: "PATCH", body: { ...draft, ...(status ? { status } : {}) } });
  };

  /** Sends one email; asks once more when the address is only a guess. */
  const sendOne = async (id: string): Promise<void> => {
    try {
      await api(`/api/outbox/${id}/send`, { method: "POST", body: {} });
    } catch (e) {
      if (e instanceof ApiError && e.data.needsConfirm && window.confirm(`${e.message}`)) {
        await api(`/api/outbox/${id}/send`, { method: "POST", body: { confirmGuessed: true } });
        return;
      }
      throw e;
    }
  };

  const sendOpen = () =>
    run("send", async () => {
      if (!open) return;
      if (dirty) await saveEdits();
      try {
        await sendOne(open.id);
      } finally {
        await reload();
      }
      setOpen(null);
      return `Sent to ${draft.to}`;
    });

  const sendApproved = async () => {
    if (!approved.length) return;
    const batch = approved.slice(0, left);
    if (!window.confirm(`Send ${batch.length} approved ${batch.length === 1 ? "email" : "emails"} now from your Gmail?`)) return;
    let ok = 0;
    const failures: string[] = [];
    for (const [n, item] of batch.entries()) {
      setBulk(`Sending ${n + 1} of ${batch.length}…`);
      try {
        await sendOne(item.id);
        ok++;
      } catch (e) {
        failures.push(`${item.to}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    await reload();
    setBulk(failures.length ? `Sent ${ok}. Not sent: ${failures.join(" | ")}` : `Sent ${ok} ${ok === 1 ? "email" : "emails"}.`);
  };

  if (error) return <Notice title="Could not load the Outbox" tone="bad">{error}</Notice>;
  const list = tab === "review" ? waiting : sent;

  return (
    <>
      <PageHeader title="Outbox" sub="Every email waits here until you send it. Nothing leaves your Gmail on its own.">
        <span className="text-xs text-muted">{data ? `${data.sentToday} of ${data.dailyCap} sent today` : ""}</span>
        <Button variant="primary" onClick={sendApproved} disabled={!approved.length || !left || !!busy}>
          Send {approved.length || ""} approved
        </Button>
      </PageHeader>

      {bulk ? <Card className="text-sm font-semibold">{bulk}</Card> : null}

      <div className="flex gap-1 border-b border-line">
        {(["review", "sent"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={"-mb-px border-b-2 px-3.5 py-2.5 text-sm font-bold " + (tab === t ? "border-accent text-fg" : "border-transparent text-muted")}
          >
            {t === "review" ? `To review (${waiting.length})` : `Sent (${sent.length})`}
          </button>
        ))}
      </div>

      {!data ? <Notice title="Loading…" /> : !list.length ? (
        <Notice title={tab === "review" ? "Nothing waiting for review" : "Nothing sent yet"}>
          {tab === "review"
            ? "Emails appear here after a run finds a strong-fit job with someone to write to, or when you press ✉ Email on a lead."
            : "Sent emails and their replies show up here."}
        </Notice>
      ) : (
        <div className="grid gap-2.5">
          {list.map((i) => (
            <Card key={i.id} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
              <button type="button" onClick={() => show(i)} className="grid gap-1 text-left">
                <span className="flex flex-wrap items-center gap-1.5">
                  {i.status === "approved" ? <Tag tone="good">Approved</Tag> : null}
                  {i.status === "failed" ? <Tag tone="bad">Failed</Tag> : null}
                  {i.status === "sending" ? <Tag tone="warn">Sending</Tag> : null}
                  {i.followUpOf ? <Tag tone="accent">Follow-up</Tag> : null}
                  {i.repliedAt ? <Tag tone="good">Replied {fmtDate(i.repliedAt)}</Tag> : null}
                  {i.job ? <Tag tone={fitTone(i.job.fit)}>{i.job.fit ?? "Not scored"}</Tag> : null}
                  <b>{i.job ? `${i.job.company} · ${i.job.role}` : i.to}</b>
                </span>
                <span className="font-semibold">{i.subject}</span>
                <span className="text-xs text-muted">
                  To {i.contact ? `${i.contact.name} · ` : ""}<span className="font-mono">{i.to}</span>
                  {i.contact?.emailStatus ? ` (${i.contact.emailStatus})` : ""}
                  {i.sentAt ? ` · sent ${fmtDate(i.sentAt)}` : ""}
                </span>
                {i.error ? <span className="text-xs text-bad">{i.error}</span> : null}
                <span className="line-clamp-2 text-sm text-muted">{i.body}</span>
              </button>
              {tab === "review" ? (
                <div className="flex gap-1.5 sm:flex-col">
                  <Button small onClick={() => show(i)}>Review</Button>
                  {i.status === "queued" || i.status === "failed" ? (
                    <Button
                      small
                      busy={busy === `approve-${i.id}`}
                      onClick={() => run(`approve-${i.id}`, async () => { await api(`/api/outbox/${i.id}`, { method: "PATCH", body: { status: "approved" } }); await reload(); })}
                    >
                      Approve
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <Drawer
        title={open?.job ? `${open.job.company} · ${open.job.role}` : "Email"}
        open={!!open}
        onClose={() => setOpen(null)}
        wide
        footer={
          open && open.status !== "sent" ? (
            <>
              <Button
                variant="danger"
                onClick={() => {
                  if (!window.confirm("Discard this email?")) return;
                  void run("discard", async () => { await api(`/api/outbox/${open.id}`, { method: "DELETE" }); await reload(); setOpen(null); return "Discarded"; });
                }}
              >
                Discard
              </Button>
              <span className="flex-1" />
              <Button busy={busy === "approve"} onClick={() => run("approve", async () => { await saveEdits("approved"); await reload(); setOpen(null); return "Approved"; })}>
                {dirty ? "Save & approve" : "Approve"}
              </Button>
              <Button variant="primary" busy={busy === "send"} onClick={sendOpen} disabled={!left || open.status === "sending"}>
                Send now
              </Button>
            </>
          ) : (
            <><span className="flex-1" /><Button onClick={() => setOpen(null)}>Close</Button></>
          )
        }
      >
        {open ? (
          <>
            {open.contact?.optedOut ? <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">This contact asked not to be contacted. Sending is blocked.</div> : null}
            {open.contact?.emailStatus === "guessed" ? <div className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">This address is a guess and may bounce.</div> : null}
            {open.error ? <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{open.error}</div> : null}
            <Label label="To"><Input type="email" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} disabled={open.status === "sent"} /></Label>
            <Label label="Subject"><Input value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} disabled={open.status === "sent"} /></Label>
            <Label label={`Message · ${draft.body.trim().split(/\s+/).filter(Boolean).length} words`}>
              <Textarea value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} className="min-h-72" disabled={open.status === "sent"} />
            </Label>
            {open.followUpOf ? (
              <p className="text-xs text-muted">Follow-ups go in the same thread as the first email, without the CV attached again.</p>
            ) : (
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted">Attached CV (tailored to this job)</span>
                  <a href={`/api/outbox/${open.id}/cv`} target="_blank" rel="noopener" className="text-xs font-semibold text-accent hover:underline">Open in new tab ↗</a>
                </div>
                <iframe title="CV preview" src={`/api/outbox/${open.id}/cv#toolbar=0`} className="h-[520px] w-full rounded-lg border border-line bg-white" />
              </div>
            )}
            {open.job?.link ? <a href={open.job.link} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent hover:underline">Open the job listing ↗</a> : null}
          </>
        ) : null}
      </Drawer>
    </>
  );
}
