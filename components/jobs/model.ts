import { fmtDate } from "@/lib/client";
import type { Job } from "@/lib/db/schema";
import { JOB_STATUSES } from "@/lib/fields";
import { ago } from "@/lib/pipeline/cleanup";

/** A job as the API sends it: dates as strings. */
export type JobRow = Omit<Job, "createdAt" | "updatedAt" | "postedAt"> & {
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
};

export const DOT: Record<string, string> = {
  Found: "bg-muted", Drafted: "bg-accent/60", Applied: "bg-accent", Replied: "bg-good/70",
  Interview: "bg-warn", Offer: "bg-good", Rejected: "bg-bad", Skipped: "bg-muted/50",
};
export const CLOSED = ["Rejected", "Skipped"];
/** The board's open columns, in order. */
export const OPEN_LANES = JOB_STATUSES.filter((st) => !CLOSED.includes(st));

const TEXT_FIELDS = [
  "company", "role", "link", "status", "fit", "source", "pay", "tier", "mode", "location",
  "found", "postedAt", "applied", "followUp", "contact", "next", "notes", "cover", "description",
] as const;
export type Form = Record<(typeof TEXT_FIELDS)[number] | "flags", string>;

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const jobsWord = (n: number) => (n === 1 ? "job" : "jobs");

export const blank = (): Form => ({
  ...(Object.fromEntries(TEXT_FIELDS.map((f) => [f, ""])) as Form),
  status: "Found",
  fit: "Strong",
  flags: "",
});

/** yyyy-mm-dd in local time, for date inputs. */
const localDay = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** The letter as it is pasted into a form or email: subject line first when there is one. */
export const letterWithSubject = (cover: string, subject?: string | null) => (subject ? `Subject: ${subject}\n\n${cover}` : cover);

export const toForm = (j: JobRow): Form => ({
  ...(Object.fromEntries(TEXT_FIELDS.map((f) => [f, (j[f] as string | null) ?? ""])) as Form),
  postedAt: j.postedAt ? localDay(j.postedAt) : "",
  flags: (j.flags ?? []).join(", "),
});

export type Filters = { q: string; fit: string; source: string };

const searchText = (j: JobRow) => norm([j.company, j.role, j.notes, j.pay, j.location, (j.flags ?? []).join(" ")].join(" "));

export function filterJobs(jobs: JobRow[], { q, fit, source }: Filters): JobRow[] {
  const needle = norm(q);
  return jobs.filter((j) => (!fit || j.fit === fit) && (!source || j.source === source) && (!needle || searchText(j).includes(needle)));
}

/** One column's cards: best score first, then most recently changed. */
export const laneJobs = (visible: JobRow[], status: string) =>
  visible
    .filter((j) => j.status === status)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.updatedAt.localeCompare(a.updatedAt));

/** The columns either side of this job's, and where a closed job goes back to. */
export function neighbours(current: JobRow | null) {
  const at = current ? OPEN_LANES.indexOf(current.status as (typeof OPEN_LANES)[number]) : -1;
  return {
    prevStatus: at > 0 ? OPEN_LANES[at - 1] : null,
    nextStatus: at >= 0 && at < OPEN_LANES.length - 1 ? OPEN_LANES[at + 1] : null,
    // A closed job goes back to Applied if it was applied to, else Found.
    reopenStatus: current && CLOSED.includes(current.status) ? (current.applied ? "Applied" : "Found") : null,
  };
}

/** " · applied 3 Jan", " · posted 2h ago" or " · found 1 Jan" for a card. */
export function cardDate(j: JobRow): string {
  if (j.applied) return ` · applied ${fmtDate(j.applied)}`;
  if (j.postedAt) return ` · posted ${ago(new Date(j.postedAt).getTime())}`;
  return j.found ? ` · found ${fmtDate(j.found)}` : "";
}
