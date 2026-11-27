"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, copyText, fmtDate, jobLink, useLoad } from "@/lib/client";
import type { Job } from "@/lib/db/schema";
import { JOB_STATUSES } from "@/lib/fields";
import { ago, isOlderThan, KEEP_STATUSES as APPLIED_OR_LATER, OLDER_THAN, type OlderThanHours } from "@/lib/pipeline/cleanup";
import { useRuns } from "./shell";
import {
  Button, Check, Drawer, fitTone, Input, Label, Notice, PageHeader, Select, Tag, Textarea,
  useAction, useToast,
} from "./ui";

type JobRow = Omit<Job, "createdAt" | "updatedAt" | "postedAt"> & {
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
};

const DOT: Record<string, string> = {
  Found: "bg-muted", Drafted: "bg-accent/60", Applied: "bg-accent", Replied: "bg-good/70",
  Interview: "bg-warn", Offer: "bg-good", Rejected: "bg-bad", Skipped: "bg-muted/50",
};
const CLOSED = ["Rejected", "Skipped"];
const TEXT_FIELDS = [
  "company", "role", "link", "status", "fit", "source", "pay", "tier", "mode", "location",
  "found", "postedAt", "applied", "followUp", "contact", "next", "notes", "cover", "description",
] as const;
type Form = Record<(typeof TEXT_FIELDS)[number] | "flags", string>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const blank = (): Form => ({
  ...(Object.fromEntries(TEXT_FIELDS.map((f) => [f, ""])) as Form),
  status: "Found",
  fit: "Strong",
  flags: "",
});
// yyyy-mm-dd in local time, for date inputs.
const localDay = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
/** The letter as it is pasted into a form or email: subject line first when there is one. */
const letterWithSubject = (cover: string, subject?: string | null) =>
  subject ? `Subject: ${subject}\n\n${cover}` : cover;

const toForm = (j: JobRow): Form => ({
  ...(Object.fromEntries(TEXT_FIELDS.map((f) => [f, (j[f] as string | null) ?? ""])) as Form),
  postedAt: j.postedAt ? localDay(j.postedAt) : "",
  flags: (j.flags ?? []).join(", "),
});

export function JobsBoard() {
  const { data, error, reload } = useLoad<{ jobs: JobRow[] }>("/api/jobs");
  const { finishedTick } = useRuns();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { busy, run } = useAction();

  const [q, setQ] = useState("");
  const [fit, setFit] = useState("");
  const [source, setSource] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [editing, setEditing] = useState<JobRow | "new" | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);
  const [askApplied, setAskApplied] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const jobs = useMemo(() => data?.jobs ?? [], [data]);

  useEffect(() => {
    if (finishedTick) void reload();
  }, [finishedTick, reload]);

  const open = (j: JobRow | "new") => {
    setEditing(j);
    setForm(j === "new" ? blank() : toForm(j));
    setAskApplied(false);
  };
  const close = () => {
    setEditing(null);
    if (params.get("open")) router.replace("/jobs");
  };

  // Deep link from the Today and Leads pages: /jobs?open=<id>
  const wanted = params.get("open");
  const [handledOpen, setHandledOpen] = useState<string | null>(null);
  if (!wanted && handledOpen) setHandledOpen(null);
  if (wanted && wanted !== handledOpen && jobs.length) {
    setHandledOpen(wanted);
    const j = jobs.find((x) => x.id === wanted);
    if (j) {
      setEditing(j);
      setForm(toForm(j));
    }
  }

  const sources = useMemo(() => [...new Set(jobs.map((j) => j.source).filter(Boolean))].sort() as string[], [jobs]);
  const visible = useMemo(() => {
    const needle = norm(q);
    return jobs.filter(
      (j) =>
        (!fit || j.fit === fit) &&
        (!source || j.source === source) &&
        (!needle ||
          norm([j.company, j.role, j.notes, j.pay, j.location, (j.flags ?? []).join(" ")].join(" ")).includes(needle)),
    );
  }, [jobs, q, fit, source]);

  const current = editing && editing !== "new" ? (jobs.find((j) => j.id === editing.id) ?? editing) : null;
  const duplicate =
    editing === "new" && form.company && form.role
      ? jobs.find((j) => norm(j.company) === norm(form.company) && norm(j.role) === norm(form.role))
      : null;

  const move = (id: string, status: string) =>
    run(`move-${id}`, async () => {
      const j = jobs.find((x) => x.id === id);
      if (!j || j.status === status) return;
      await api(`/api/jobs/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } });
      await reload();
      return `${j.company} → ${status}`;
    });

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const deleteSelected = () => {
    const ids = [...selected].filter((id) => jobs.some((j) => j.id === id));
    if (!ids.length || !window.confirm(`Delete ${ids.length} selected ${ids.length === 1 ? "job" : "jobs"}?`)) return;
    void run("bulk", async () => {
      const r = await api<{ deleted: number }>("/api/jobs/delete", { body: { ids } });
      await reload();
      stopSelecting();
      return `Deleted ${r.deleted} ${r.deleted === 1 ? "job" : "jobs"}`;
    });
  };

  const deleteOlder = (hours: OlderThanHours) => {
    const label = OLDER_THAN.find((o) => o.hours === hours)!.label.replace("Older than", "").trim();
    const count = jobs.filter((j) => isOlderThan(j, hours)).length;
    if (!count) {
      toast(`No jobs older than ${label}.`);
      return;
    }
    if (!window.confirm(`Delete ${count} ${count === 1 ? "job" : "jobs"} posted more than ${label} ago? Jobs you applied to are kept.`)) return;
    void run("older", async () => {
      const r = await api<{ deleted: number; kept: number }>("/api/jobs/delete", { body: { olderThanHours: hours } });
      await reload();
      return `Deleted ${r.deleted} ${r.deleted === 1 ? "job" : "jobs"}${r.kept ? `, kept ${r.kept} with a sent email` : ""}`;
    });
  };

  // The server holds the rules (pay, place, remote-only-abroad), so ask it what would go first.
  const deleteOutsideFilters = () =>
    void run("older", async () => {
      const preview = await api<{ jobs: { company: string; role: string; reason: string }[] }>("/api/jobs/delete", {
        body: { outsideFilters: true, dryRun: true },
      });
      const n = preview.jobs.length;
      if (!n) return "Every job matches your filters.";
      const sample = preview.jobs.slice(0, 8).map((j) => `• ${j.company} · ${j.role}: ${j.reason}`).join("\n");
      const more = n > 8 ? `\n…and ${n - 8} more` : "";
      if (!window.confirm(`Delete ${n} ${n === 1 ? "job" : "jobs"} that don't match your filters? Jobs you applied to are kept.\n\n${sample}${more}`)) return;
      const r = await api<{ deleted: number }>("/api/jobs/delete", { body: { outsideFilters: true } });
      await reload();
      return `Deleted ${r.deleted} ${r.deleted === 1 ? "job" : "jobs"}`;
    });

  // `status`: also move the job to that column. Moving to Applied or later
  // dates it today if no date applied is set yet.
  const save = (opts?: { status?: string }) =>
    run(opts?.status ? `move-to-${opts.status}` : "save", async () => {
      const body: Record<string, unknown> = {
        ...form,
        flags: form.flags.split(",").map((s) => s.trim()).filter(Boolean),
      };
      if (opts?.status) {
        body.status = opts.status;
        // Today on this computer's calendar, as YYYY-MM-DD.
        if (APPLIED_OR_LATER.includes(opts.status) && !form.applied) body.applied = new Date().toLocaleDateString("en-CA");
      }
      // Keep the exact posting time unless the date was changed by hand.
      if (current && form.postedAt === toForm(current).postedAt) delete body.postedAt;
      if (editing === "new") {
        const added = await api<{ id: string; existing?: boolean }>("/api/jobs", { body });
        if (added.existing) {
          await reload();
          setEditing(null);
          return `${form.company} · ${form.role} is already on your board, so nothing was added.`;
        }
      } else if (editing) await api(`/api/jobs/${encodeURIComponent(editing.id)}`, { method: "PATCH", body });
      await reload();
      setEditing(null);
      return opts?.status ? `${form.company} → ${opts.status}` : "Saved";
    });

  // The board's columns in order, and the ones either side of this job's.
  const OPEN = JOB_STATUSES.filter((st) => !CLOSED.includes(st));
  const at = current ? OPEN.indexOf(current.status as (typeof OPEN)[number]) : -1;
  const prevStatus = at > 0 ? OPEN[at - 1] : null;
  const nextStatus = at >= 0 && at < OPEN.length - 1 ? OPEN[at + 1] : null;
  // A closed job goes back to Applied if it was applied to, else Found.
  const reopenStatus = current && CLOSED.includes(current.status) ? (current.applied ? "Applied" : "Found") : null;
  const formOk = !!form.company.trim() && !!form.role.trim();

  // Shown until the job is applied to (or further along).
  const canMarkApplied = !!current && !APPLIED_OR_LATER.includes(current.status);

  // Tells the app which job is being applied to, so the browser extension can find it.
  const markActive = (jobId: string) =>
    void api("/api/apply/active", { body: { jobId } }).catch((err) => console.warn("Could not tell the extension which job is open:", err));

  const openPost = () => {
    if (!current?.link) return;
    markActive(current.id);
    window.open(jobLink(current.link, current.id), "_blank", "noopener");
  };

  const applyKit = async () => {
    if (!current) return;
    markActive(current.id);
    const copied = current.cover ? await copyText(letterWithSubject(current.cover, current.pitch?.subject)) : false;
    window.open(`/api/jobs/${encodeURIComponent(current.id)}/cv`, "_blank");
    if (current.link) window.open(jobLink(current.link, current.id), "_blank", "noopener");
    setAskApplied(true);
    toast(
      copied
        ? "Cover letter copied, CV downloading, listing opened in a new tab."
        : "CV downloading and listing opened. Copy the cover letter from the box below.",
    );
  };

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (error) return <Notice title="Could not load jobs" tone="bad">{error}</Notice>;

  const lanes = JOB_STATUSES.filter((s) => showClosed || !CLOSED.includes(s));

  return (
    <>
      <PageHeader title="Jobs" sub="Drag a card to move it, or click it to edit, draft and apply.">
        <Button variant="primary" onClick={() => open("new")}>+ Add job</Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" placeholder="Search company, role, notes…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs flex-1" aria-label="Search jobs" />
        <Select value={fit} onChange={(e) => setFit(e.target.value)} className="w-auto" aria-label="Fit">
          <option value="">Any fit</option>
          <option>Strong</option>
          <option>Partial</option>
          <option>Skip</option>
        </Select>
        <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-auto" aria-label="Source">
          <option value="">Any source</option>
          {sources.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Check label="Show Rejected & Skipped" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            value=""
            onChange={(e) => (e.target.value === "filters" ? deleteOutsideFilters() : deleteOlder(Number(e.target.value) as OlderThanHours))}
            className="w-auto"
            aria-label="Clean up jobs"
            disabled={busy === "older" || !jobs.length}
          >
            <option value="">Clean up…</option>
            {OLDER_THAN.map((o) => <option key={o.hours} value={o.hours}>Delete {o.label.toLowerCase()}</option>)}
            <option value="filters">Delete jobs not matching my filters</option>
          </Select>
          <Button onClick={() => (selecting ? stopSelecting() : setSelecting(true))} disabled={!jobs.length}>
            {selecting ? "Done selecting" : "Select"}
          </Button>
        </span>
      </div>

      {selecting ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          <b>{selected.size} selected</b>
          <span className="text-muted">Click cards to select them.</span>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button small onClick={() => setSelected(new Set(visible.filter((j) => (lanes as readonly string[]).includes(j.status)).map((j) => j.id)))}>
              Select all shown
            </Button>
            <Button small onClick={() => setSelected(new Set())} disabled={!selected.size}>Clear</Button>
            <Button small variant="danger" onClick={deleteSelected} busy={busy === "bulk"} disabled={!selected.size}>
              Delete selected
            </Button>
          </span>
        </div>
      ) : null}

      {!data ? <Notice title="Loading jobs…" /> : !jobs.length ? (
        <Notice title="No jobs yet">Press “Find new jobs” at the top, or add one by hand.</Notice>
      ) : null}

      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        {/* Every column shares the width, so all of them are always in view; only very narrow windows scroll. */}
        <div
          className="grid items-start gap-2"
          style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(170px, 1fr))` }}
        >
          {lanes.map((status) => {
            const list = visible
              .filter((j) => j.status === status)
              .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.updatedAt.localeCompare(a.updatedAt));
            return (
              <section
                key={status}
                aria-label={status}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverLane(status); } }}
                onDragLeave={() => setOverLane((l) => (l === status ? null : l))}
                onDrop={(e) => { e.preventDefault(); setOverLane(null); if (dragId) void move(dragId, status); setDragId(null); }}
                className={"grid min-h-44 min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2 rounded-xl border-2 bg-sunk p-2.5 " + (overLane === status ? "border-accent" : "border-transparent")}
              >
                <div className="flex items-center gap-2 px-1 pb-1 font-bold">
                  <i className={`h-2 w-2 rounded-full ${DOT[status]}`} />
                  {status}
                  <span className="ml-auto font-mono text-xs text-muted">{list.length}</span>
                </div>
                {list.length ? list.map((j) => (
                  <article
                    key={j.id}
                    draggable={!selecting}
                    tabIndex={0}
                    onDragStart={(e) => { setDragId(j.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", j.id); }}
                    onDragEnd={() => { setDragId(null); setOverLane(null); }}
                    onClick={() => (selecting ? toggle(j.id) : open(j))}
                    onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && (selecting ? toggle(j.id) : open(j))}
                    className={
                      "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 rounded-lg border bg-surface p-2.5 shadow-sm hover:border-accent " +
                      (selecting ? "cursor-pointer " : "cursor-grab ") +
                      (selecting && selected.has(j.id) ? "border-accent ring-2 ring-accent/40 " : "border-line ") +
                      (dragId === j.id ? "opacity-45" : "")
                    }
                  >
                    <div className="flex items-baseline gap-1.5 text-[14.5px] font-bold">
                      {selecting ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${j.company} · ${j.role}`}
                          checked={selected.has(j.id)}
                          onChange={() => toggle(j.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 shrink-0 self-center accent-[var(--accent)]"
                        />
                      ) : null}
                      <span className="min-w-0 break-words">{j.company}</span>
                      {j.link ? (
                        <a href={jobLink(j.link, j.id)} target="_blank" rel="noopener noreferrer" title="Open listing" onClick={(e) => { e.stopPropagation(); markActive(j.id); }} className="ml-auto text-xs text-muted hover:text-accent">↗</a>
                      ) : null}
                    </div>
                    <div className="text-[13px] break-words text-muted">{j.role}</div>
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {j.fit ? <Tag tone={fitTone(j.fit)}>{j.fit}{j.score != null ? ` ${j.score}` : ""}</Tag> : <Tag>Not scored</Tag>}
                      {j.kind === "post" ? <Tag tone="warn">Post · apply by hand</Tag> : null}
                      {j.tier ? <Tag tone="accent">{j.tier}</Tag> : null}
                      {j.pay ? <Tag>{j.pay.slice(0, 28)}</Tag> : null}
                      {(j.flags ?? []).map((f) => <Tag key={f} tone="bad">{f}</Tag>)}
                    </div>
                    <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
                      <span>
                        {j.cover ? "✉ " : ""}{j.source ?? ""}{j.alsoOn?.length ? <span title={`Also on ${j.alsoOn.join(", ")}`}> +{j.alsoOn.length}</span> : null}
                        {j.applied
                          ? ` · applied ${fmtDate(j.applied)}`
                          : j.postedAt
                            ? ` · posted ${ago(new Date(j.postedAt).getTime())}`
                            : j.found ? ` · found ${fmtDate(j.found)}` : ""}
                      </span>
                      <select
                        aria-label={`Move ${j.company}`}
                        value={j.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => void move(j.id, e.target.value)}
                        className="rounded-md border border-line bg-surface px-1 py-0.5 font-sans text-xs"
                      >
                        {JOB_STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  </article>
                )) : (
                  <div className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-xs text-muted">Drop a card here</div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <Drawer
        title={editing === "new" ? "Add job" : current ? `${current.company} · ${current.role}` : ""}
        open={!!editing}
        onClose={close}
        wide
        footer={
          <>
            {current ? (
              <div className="flex basis-full flex-wrap items-center gap-2 pb-2 text-sm">
                <span className="font-semibold text-muted">Move to</span>
                {prevStatus ? (
                  <Button small busy={busy === `move-to-${prevStatus}`} disabled={!formOk} onClick={() => save({ status: prevStatus })}>← {prevStatus}</Button>
                ) : null}
                <Tag tone="accent">{current.status}</Tag>
                {nextStatus ? (
                  <Button small busy={busy === `move-to-${nextStatus}`} disabled={!formOk} onClick={() => save({ status: nextStatus })}>{nextStatus} →</Button>
                ) : null}
                <span className="flex-1" />
                {reopenStatus ? (
                  <Button small busy={busy === `move-to-${reopenStatus}`} disabled={!formOk} onClick={() => save({ status: reopenStatus })}>↺ Back to {reopenStatus}</Button>
                ) : null}
                {CLOSED.filter((st) => st !== current.status).map((st) => (
                  <Button key={st} small busy={busy === `move-to-${st}`} disabled={!formOk} onClick={() => save({ status: st })}>{st}</Button>
                ))}
              </div>
            ) : null}
            {current ? (
              <Button
                variant="danger"
                busy={busy === "delete"}
                onClick={() => {
                  if (!window.confirm(`Delete ${current.company} · ${current.role}?`)) return;
                  void run("delete", async () => {
                    await api(`/api/jobs/${encodeURIComponent(current.id)}`, { method: "DELETE" });
                    await reload();
                    setEditing(null);
                    return "Deleted";
                  });
                }}
              >
                Delete
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button onClick={close}>Cancel</Button>
            {canMarkApplied ? (
              <Button busy={busy === "move-to-Applied"} onClick={() => save({ status: "Applied" })} disabled={!formOk}>
                ✓ Mark as applied
              </Button>
            ) : null}
            <Button variant="primary" busy={busy === "save"} onClick={() => save()} disabled={!formOk}>
              Save
            </Button>
          </>
        }
      >
        {duplicate ? (
          <div className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">
            Already on the board: {duplicate.company} · {duplicate.role} ({duplicate.status}).
          </div>
        ) : null}

        {current ? (
          <div className="grid gap-2 rounded-lg bg-sunk p-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={applyKit} disabled={!current.link && !current.cover}>
                Apply kit
              </Button>
              <Button onClick={openPost} disabled={!current.link}>
                Open job post ↗
              </Button>
              <Button
                busy={busy === "draft"}
                onClick={() =>
                  run("draft", async () => {
                    const r = await api<{ queued: boolean }>(`/api/jobs/${encodeURIComponent(current.id)}/draft`, { method: "POST" });
                    const fresh = await api<{ jobs: JobRow[] }>("/api/jobs");
                    await reload();
                    const j = fresh.jobs.find((x) => x.id === current.id);
                    if (j) setForm(toForm(j));
                    return r.queued ? "Draft written and added to the Outbox." : "Draft written. No email contact yet, so it stays here for a portal application.";
                  })
                }
              >
                {busy === "draft"
                  ? "Researching company and writing…"
                  : current.cvVariant ? "Rewrite with AI" : "Write with AI"}
              </Button>
              <a href={`/api/jobs/${encodeURIComponent(current.id)}/cv?inline`} target="_blank" rel="noopener" className="inline-flex items-center rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold hover:border-accent">
                {current.cvVariant ? "Preview tailored CV" : "Preview CV"}
              </a>
            </div>
            <p className="text-xs text-muted">
              Apply kit copies the cover letter, downloads the CV for this job and opens the listing. With the JobPilot browser extension, press its icon on the application form to fill it. You press submit on their site.
            </p>
            {askApplied ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b>Did you submit the application?</b>
                <Button small variant="primary" onClick={() => { void move(current.id, "Applied"); setAskApplied(false); setForm((f) => ({ ...f, status: "Applied" })); }}>
                  Yes, mark Applied
                </Button>
                <Button small onClick={() => setAskApplied(false)}>Not yet</Button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Label label="Company"><Input value={form.company} onChange={set("company")} required /></Label>
          <Label label="Role"><Input value={form.role} onChange={set("role")} required /></Label>
        </div>
        <Label label="Link"><Input type="url" placeholder="https://" value={form.link} onChange={set("link")} /></Label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Label label="Status">
            <Select value={form.status} onChange={set("status")}>{JOB_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
          </Label>
          <Label label="Fit">
            <Select value={form.fit} onChange={set("fit")}>
              <option value="">Not scored</option><option>Strong</option><option>Partial</option><option>Skip</option>
            </Select>
          </Label>
          <Label label="Source"><Input value={form.source} onChange={set("source")} placeholder="LinkedIn" /></Label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Label label="Pay"><Input value={form.pay} onChange={set("pay")} /></Label>
          <Label label="Work mode"><Input value={form.mode} onChange={set("mode")} placeholder="Remote, Hybrid, Onsite" /></Label>
          <Label label="Location"><Input value={form.location} onChange={set("location")} /></Label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Label label="Date posted"><Input type="date" value={form.postedAt} onChange={set("postedAt")} /></Label>
          <Label label="Date found"><Input type="date" value={form.found} onChange={set("found")} /></Label>
          <Label label="Date applied">
            <div className="flex gap-2">
              <Input type="date" value={form.applied} onChange={set("applied")} />
              {canMarkApplied ? (
                <Button small busy={busy === "move-to-Applied"} onClick={() => save({ status: "Applied" })} title="Move this job to Applied, dated today">
                  Applied today
                </Button>
              ) : null}
            </div>
          </Label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Label label="Follow up on"><Input type="date" value={form.followUp} onChange={set("followUp")} /></Label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label label="Next step"><Input value={form.next} onChange={set("next")} placeholder="Interview Fri 9 PM" /></Label>
          <Label label="Red flags (comma separated)"><Input value={form.flags} onChange={set("flags")} /></Label>
        </div>
        <Label label="Notes"><Textarea value={form.notes} onChange={set("notes")} /></Label>
        {current?.pitch ? (
          <div className="grid gap-2 rounded-xl border border-line bg-surface p-4 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">The pitch</div>
            <div><b>Subject:</b> {current.pitch.subject}</div>
            {current.pitch.problem ? <div><b>Problem:</b> {current.pitch.problem}</div> : null}
            {current.pitch.approach ? <div><b>What you&apos;d build:</b> {current.pitch.approach}</div> : null}
            {current.pitch.buildPlan.length ? (
              <details>
                <summary className="cursor-pointer font-semibold">Build plan for the call (only you see this)</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  {current.pitch.buildPlan.map((step, i) => <li key={i}>{step}</li>)}
                </ol>
              </details>
            ) : null}
            {current.pitch.research ? (
              <details>
                <summary className="cursor-pointer text-muted">What the AI learned about {current.company}</summary>
                <p className="mt-2 text-muted">{current.pitch.research}</p>
              </details>
            ) : null}
          </div>
        ) : null}
        <Label label="Cover letter / email">
          <Textarea value={form.cover} onChange={set("cover")} className="min-h-48" />
        </Label>
        <div>
          <Button
            small
            onClick={async () =>
              toast((await copyText(letterWithSubject(form.cover, current?.pitch?.subject))) ? "Cover letter copied" : "Select the text and press Cmd+C")
            }
            disabled={!form.cover}
          >
            Copy cover letter
          </Button>
        </div>
        <Label label="Job description" hint="Used by the AI to score the job and tailor the email and CV.">
          <Textarea value={form.description} onChange={set("description")} className="min-h-32" />
        </Label>
      </Drawer>
    </>
  );
}
