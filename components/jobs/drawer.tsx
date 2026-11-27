"use client";

import { copyText } from "@/lib/client";
import { JOB_STATUSES } from "@/lib/fields";
import { KEEP_STATUSES as APPLIED_OR_LATER } from "@/lib/pipeline/cleanup";
import { Button, Drawer, Input, Label, Select, Tag, Textarea } from "../ui";
import { applyKit, type BoardCtx, deleteJob, draftWithAi, moveJob, openPost, saveJob } from "./actions";
import type { JobEditor } from "./hooks";
import { CLOSED, type JobRow, letterWithSubject, neighbours } from "./model";

type DrawerProps = { ctx: BoardCtx; editor: JobEditor; busy: string | null; duplicate: JobRow | null };
type Save = (status?: string) => void;

const formOk = (e: JobEditor) => !!e.form.company.trim() && !!e.form.role.trim();
/** Shown until the job is applied to (or further along). */
const canMarkApplied = (current: JobRow | null) => !!current && !APPLIED_OR_LATER.includes(current.status);

function MoveRow({ current, busy, ok, save }: { current: JobRow; busy: string | null; ok: boolean; save: Save }) {
  const { prevStatus, nextStatus, reopenStatus } = neighbours(current);
  const moveButton = (st: string, label: string) => (
    <Button key={st} small busy={busy === `move-to-${st}`} disabled={!ok} onClick={() => save(st)}>{label}</Button>
  );
  return (
    <div className="flex basis-full flex-wrap items-center gap-2 pb-2 text-sm">
      <span className="font-semibold text-muted">Move to</span>
      {prevStatus ? moveButton(prevStatus, `← ${prevStatus}`) : null}
      <Tag tone="accent">{current.status}</Tag>
      {nextStatus ? moveButton(nextStatus, `${nextStatus} →`) : null}
      <span className="flex-1" />
      {reopenStatus ? moveButton(reopenStatus, `↺ Back to ${reopenStatus}`) : null}
      {CLOSED.filter((st) => st !== current.status).map((st) => moveButton(st, st))}
    </div>
  );
}

function DrawerFooter({ ctx, editor, busy, save }: Omit<DrawerProps, "duplicate"> & { save: Save }) {
  const { current } = editor;
  const ok = formOk(editor);
  return (
    <>
      {current ? <MoveRow current={current} busy={busy} ok={ok} save={save} /> : null}
      {current ? (
        <Button variant="danger" busy={busy === "delete"} onClick={() => deleteJob(ctx, current, editor.done)}>
          Delete
        </Button>
      ) : null}
      <span className="flex-1" />
      <Button onClick={editor.close}>Cancel</Button>
      {canMarkApplied(current) ? (
        <Button busy={busy === "move-to-Applied"} onClick={() => save("Applied")} disabled={!ok}>
          ✓ Mark as applied
        </Button>
      ) : null}
      <Button variant="primary" busy={busy === "save"} onClick={() => save()} disabled={!ok}>
        Save
      </Button>
    </>
  );
}

function AskApplied({ ctx, editor, current }: { ctx: BoardCtx; editor: JobEditor; current: JobRow }) {
  const yes = () => {
    void moveJob(ctx, current.id, "Applied");
    editor.setAskApplied(false);
    editor.setForm((f) => ({ ...f, status: "Applied" }));
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <b>Did you submit the application?</b>
      <Button small variant="primary" onClick={yes}>Yes, mark Applied</Button>
      <Button small onClick={() => editor.setAskApplied(false)}>Not yet</Button>
    </div>
  );
}

function draftLabel(busy: string | null, current: JobRow) {
  if (busy === "draft") return "Researching company and writing…";
  return current.cvVariant ? "Rewrite with AI" : "Write with AI";
}

function ApplyPanel({ ctx, editor, busy, current }: Omit<DrawerProps, "duplicate"> & { current: JobRow }) {
  return (
    <div className="grid gap-2 rounded-lg bg-sunk p-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => applyKit(current, ctx.toast, () => editor.setAskApplied(true))} disabled={!current.link && !current.cover}>
          Apply kit
        </Button>
        <Button onClick={() => openPost(current)} disabled={!current.link}>Open job post ↗</Button>
        <Button busy={busy === "draft"} onClick={() => draftWithAi(ctx, current, editor.setForm)}>{draftLabel(busy, current)}</Button>
        <a href={`/api/jobs/${encodeURIComponent(current.id)}/cv?inline`} target="_blank" rel="noopener" className="inline-flex items-center rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold hover:border-accent">
          {current.cvVariant ? "Preview tailored CV" : "Preview CV"}
        </a>
      </div>
      <p className="text-xs text-muted">
        Apply kit copies the cover letter, downloads the CV for this job and opens the listing. With the JobPilot browser extension, press its icon on the application form to fill it. You press submit on their site.
      </p>
      {editor.askApplied ? <AskApplied ctx={ctx} editor={editor} current={current} /> : null}
    </div>
  );
}

function MainFields({ editor: { form, set } }: { editor: JobEditor }) {
  return (
    <>
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
    </>
  );
}

function DateFields({ editor, busy, save }: { editor: JobEditor; busy: string | null; save: Save }) {
  const { form, set } = editor;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Label label="Date posted"><Input type="date" value={form.postedAt} onChange={set("postedAt")} /></Label>
        <Label label="Date found"><Input type="date" value={form.found} onChange={set("found")} /></Label>
        <Label label="Date applied">
          <div className="flex gap-2">
            <Input type="date" value={form.applied} onChange={set("applied")} />
            {canMarkApplied(editor.current) ? (
              <Button small busy={busy === "move-to-Applied"} onClick={() => save("Applied")} title="Move this job to Applied, dated today">
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
    </>
  );
}

function PitchCard({ current }: { current: JobRow }) {
  const pitch = current.pitch;
  if (!pitch) return null;
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-surface p-4 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">The pitch</div>
      <div><b>Subject:</b> {pitch.subject}</div>
      {pitch.problem ? <div><b>Problem:</b> {pitch.problem}</div> : null}
      {pitch.approach ? <div><b>What you&apos;d build:</b> {pitch.approach}</div> : null}
      {pitch.buildPlan.length ? (
        <details>
          <summary className="cursor-pointer font-semibold">Build plan for the call (only you see this)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {pitch.buildPlan.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </details>
      ) : null}
      {pitch.research ? (
        <details>
          <summary className="cursor-pointer text-muted">What the AI learned about {current.company}</summary>
          <p className="mt-2 text-muted">{pitch.research}</p>
        </details>
      ) : null}
    </div>
  );
}

function LetterFields({ ctx, editor }: { ctx: BoardCtx; editor: JobEditor }) {
  const { form, set, current } = editor;
  const copy = async () => ctx.toast((await copyText(letterWithSubject(form.cover, current?.pitch?.subject))) ? "Cover letter copied" : "Select the text and press Cmd+C");
  return (
    <>
      <Label label="Cover letter / email">
        <Textarea value={form.cover} onChange={set("cover")} className="min-h-48" />
      </Label>
      <div>
        <Button small onClick={copy} disabled={!form.cover}>Copy cover letter</Button>
      </div>
      <Label label="Job description" hint="Used by the AI to score the job and tailor the email and CV.">
        <Textarea value={form.description} onChange={set("description")} className="min-h-32" />
      </Label>
    </>
  );
}

function drawerTitle({ editing, current }: JobEditor) {
  if (editing === "new") return "Add job";
  return current ? `${current.company} · ${current.role}` : "";
}

export function JobDrawer({ ctx, editor, busy, duplicate }: DrawerProps) {
  const { current } = editor;
  const save: Save = (status) => void saveJob(ctx, editor, status);
  return (
    <Drawer title={drawerTitle(editor)} open={!!editor.editing} onClose={editor.close} wide footer={<DrawerFooter ctx={ctx} editor={editor} busy={busy} save={save} />}>
      {duplicate ? (
        <div className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">
          Already on the board: {duplicate.company} · {duplicate.role} ({duplicate.status}).
        </div>
      ) : null}
      {current ? <ApplyPanel ctx={ctx} editor={editor} busy={busy} current={current} /> : null}
      <MainFields editor={editor} />
      <DateFields editor={editor} busy={busy} save={save} />
      {current ? <PitchCard current={current} /> : null}
      <LetterFields ctx={ctx} editor={editor} />
    </Drawer>
  );
}
