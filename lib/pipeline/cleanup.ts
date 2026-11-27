/** Jobs you have acted on; clearing out old jobs never deletes these. */
export const KEEP_STATUSES = ["Applied", "Replied", "Interview", "Offer"];

export const OLDER_THAN = [
  { hours: 24, label: "Older than 24 hours" },
  { hours: 48, label: "Older than 2 days" },
  { hours: 72, label: "Older than 3 days" },
] as const;

export type OlderThanHours = (typeof OLDER_THAN)[number]["hours"];

export const isOlderThanHours = (v: unknown): v is OlderThanHours => OLDER_THAN.some((o) => o.hours === v);

export type AgedJob = {
  status: string;
  postedAt?: Date | string | null;
  createdAt?: Date | string | null;
  found?: string | null;
};

const time = (v: Date | string | null | undefined) => {
  if (!v) return null;
  const t = new Date(typeof v === "string" && v.length === 10 ? `${v}T00:00:00` : v).getTime();
  return Number.isNaN(t) ? null : t;
};

/** When the job was posted, or when JobPilot found it if the board gave no date. */
export const jobDate = (job: AgedJob): number | null =>
  time(job.postedAt) ?? time(job.createdAt) ?? time(job.found);

export function isOlderThan(job: AgedJob, hours: number, now = Date.now()): boolean {
  if (KEEP_STATUSES.includes(job.status)) return false;
  const t = jobDate(job);
  return t != null && now - t > hours * 36e5;
}

/** "5h ago", "2d ago" */
export function ago(t: number, now = Date.now()): string {
  const h = Math.max(0, Math.floor((now - t) / 36e5));
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/** Turns a form or API value into a stored date; a bare date counts as midday UTC. */
export function toPostedAt(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}
