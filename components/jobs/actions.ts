import { api, copyText, jobLink } from "@/lib/client";
import { isOlderThan, KEEP_STATUSES as APPLIED_OR_LATER, OLDER_THAN, type OlderThanHours } from "@/lib/pipeline/cleanup";
import type { useAction, useToast } from "../ui";
import { type Form, type JobRow, jobsWord, letterWithSubject, toForm } from "./model";

/** What every board action needs: the jobs, a reload, the busy-key runner and the toast. */
export type BoardCtx = {
  jobs: JobRow[];
  reload: () => Promise<unknown>;
  run: ReturnType<typeof useAction>["run"];
  toast: ReturnType<typeof useToast>;
};

const jobUrl = (id: string) => `/api/jobs/${encodeURIComponent(id)}`;

export const moveJob = ({ jobs, reload, run }: BoardCtx, id: string, status: string) =>
  run(`move-${id}`, async () => {
    const j = jobs.find((x) => x.id === id);
    if (!j || j.status === status) return;
    await api(jobUrl(id), { method: "PATCH", body: { status } });
    await reload();
    return `${j.company} → ${status}`;
  });

export function deleteSelected({ jobs, reload, run }: BoardCtx, selected: Set<string>, onDone: () => void) {
  const known = new Set(jobs.map((j) => j.id));
  const ids = [...selected].filter((id) => known.has(id));
  if (!ids.length || !window.confirm(`Delete ${ids.length} selected ${jobsWord(ids.length)}?`)) return;
  void run("bulk", async () => {
    const r = await api<{ deleted: number }>("/api/jobs/delete", { body: { ids } });
    await reload();
    onDone();
    return `Deleted ${r.deleted} ${jobsWord(r.deleted)}`;
  });
}

export function deleteOlder({ jobs, reload, run, toast }: BoardCtx, hours: OlderThanHours) {
  const label = OLDER_THAN.find((o) => o.hours === hours)!.label.replace("Older than", "").trim();
  const count = jobs.filter((j) => isOlderThan(j, hours)).length;
  if (!count) {
    toast(`No jobs older than ${label}.`);
    return;
  }
  if (!window.confirm(`Delete ${count} ${jobsWord(count)} posted more than ${label} ago? Jobs you applied to are kept.`)) return;
  void run("older", async () => {
    const r = await api<{ deleted: number; kept: number }>("/api/jobs/delete", { body: { olderThanHours: hours } });
    await reload();
    return `Deleted ${r.deleted} ${jobsWord(r.deleted)}${r.kept ? `, kept ${r.kept} with a sent email` : ""}`;
  });
}

type Outside = { jobs: { company: string; role: string; reason: string }[] };
const SAMPLE = 8;

/** The server holds the rules (pay, place, remote-only-abroad), so it is asked what would go first. */
export const deleteOutsideFilters = ({ reload, run }: BoardCtx) =>
  void run("older", async () => {
    const preview = await api<Outside>("/api/jobs/delete", { body: { outsideFilters: true, dryRun: true } });
    const n = preview.jobs.length;
    if (!n) return "Every job matches your filters.";
    const sample = preview.jobs.slice(0, SAMPLE).map((j) => `• ${j.company} · ${j.role}: ${j.reason}`).join("\n");
    const more = n > SAMPLE ? `\n…and ${n - SAMPLE} more` : "";
    if (!window.confirm(`Delete ${n} ${jobsWord(n)} that don't match your filters? Jobs you applied to are kept.\n\n${sample}${more}`)) return;
    const r = await api<{ deleted: number }>("/api/jobs/delete", { body: { outsideFilters: true } });
    await reload();
    return `Deleted ${r.deleted} ${jobsWord(r.deleted)}`;
  });

export type Editing = JobRow | "new" | null;

/** The PATCH/POST body. Moving to Applied or later dates it today if no date applied is set yet. */
function saveBody(form: Form, current: JobRow | null, status?: string): Record<string, unknown> {
  const body: Record<string, unknown> = { ...form, flags: form.flags.split(",").map((s) => s.trim()).filter(Boolean) };
  if (status) {
    body.status = status;
    // Today on this computer's calendar, as YYYY-MM-DD.
    if (APPLIED_OR_LATER.includes(status) && !form.applied) body.applied = new Date().toLocaleDateString("en-CA");
  }
  // Keep the exact posting time unless the date was changed by hand.
  if (current && form.postedAt === toForm(current).postedAt) delete body.postedAt;
  return body;
}

/** Saves the drawer; `status` also moves the job to that column. */
export const saveJob = (
  { reload, run }: BoardCtx,
  edit: { editing: Editing; form: Form; current: JobRow | null; done: () => void },
  status?: string,
) =>
  run(status ? `move-to-${status}` : "save", async () => {
    const { editing, form, current, done } = edit;
    const body = saveBody(form, current, status);
    if (editing === "new") {
      const added = await api<{ id: string; existing?: boolean }>("/api/jobs", { body });
      if (added.existing) {
        await reload();
        done();
        return `${form.company} · ${form.role} is already on your board, so nothing was added.`;
      }
    } else if (editing) await api(jobUrl(editing.id), { method: "PATCH", body });
    await reload();
    done();
    return status ? `${form.company} → ${status}` : "Saved";
  });

export function deleteJob({ reload, run }: BoardCtx, current: JobRow, done: () => void) {
  if (!window.confirm(`Delete ${current.company} · ${current.role}?`)) return;
  void run("delete", async () => {
    await api(jobUrl(current.id), { method: "DELETE" });
    await reload();
    done();
    return "Deleted";
  });
}

/** Writes (or rewrites) the letter and CV selection with the AI, then refreshes the form. */
export const draftWithAi = ({ reload, run }: BoardCtx, current: JobRow, setForm: (f: Form) => void) =>
  run("draft", async () => {
    const r = await api<{ queued: boolean }>(`${jobUrl(current.id)}/draft`, { method: "POST" });
    const fresh = await api<{ jobs: JobRow[] }>("/api/jobs");
    await reload();
    const j = fresh.jobs.find((x) => x.id === current.id);
    if (j) setForm(toForm(j));
    return r.queued ? "Draft written and added to the Outbox." : "Draft written. No email contact yet, so it stays here for a portal application.";
  });

/** Tells the app which job is being applied to, so the browser extension can find it. */
export const markActive = (jobId: string) =>
  void api("/api/apply/active", { body: { jobId } }).catch((err) => console.warn("Could not tell the extension which job is open:", err));

export function openPost(current: JobRow) {
  if (!current.link) return;
  markActive(current.id);
  window.open(jobLink(current.link, current.id), "_blank", "noopener");
}

/** Copies the letter, downloads the CV and opens the listing; then asks whether you applied. */
export async function applyKit(current: JobRow, toast: BoardCtx["toast"], askApplied: () => void) {
  markActive(current.id);
  const copied = current.cover ? await copyText(letterWithSubject(current.cover, current.pitch?.subject)) : false;
  window.open(`${jobUrl(current.id)}/cv`, "_blank");
  if (current.link) window.open(jobLink(current.link, current.id), "_blank", "noopener");
  askApplied();
  toast(
    copied
      ? "Cover letter copied, CV downloading, listing opened in a new tab."
      : "CV downloading and listing opened. Copy the cover letter from the box below.",
  );
}
