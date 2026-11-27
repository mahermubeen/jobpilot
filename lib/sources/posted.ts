/** How far back a search looks: past 24 hours, 3 days or a week. */
export type PostedWithin = 1 | 3 | 7;

export const POSTED_WITHIN: { days: PostedWithin; label: string }[] = [
  { days: 1, label: "Past 24 hours" },
  { days: 3, label: "Past 3 days" },
  { days: 7, label: "Past week" },
];

export const isPostedWithin = (v: unknown): v is PostedWithin => v === 1 || v === 3 || v === 7;

export const postedWithinLabel = (days: PostedWithin) =>
  POSTED_WITHIN.find((w) => w.days === days)?.label.toLowerCase() ?? `past ${days} days`;

const UNIT_MS: Record<string, number> = {
  minute: 6e4,
  hour: 36e5,
  day: 864e5,
  week: 6048e5,
  month: 2592e6,
  year: 31536e6,
};

/** Epoch seconds or milliseconds; null unless a positive finite number. */
const epochDate = (n: number) => (Number.isFinite(n) && n > 0 ? new Date(n < 1e12 ? n * 1000 : n) : null);

const validDate = (d: Date) => (Number.isNaN(d.getTime()) ? null : d);

/** ISO dates and epoch strings; undefined when the text is not one of those. */
function parseAbsolute(t: string, raw: string): Date | null | undefined {
  if (/^\d{10,13}$/.test(t)) return epochDate(Number(t));
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return validDate(new Date(`${t}T23:59:59Z`));
  if (/^\d{4}-\d{2}-\d{2}t/.test(t)) return validDate(new Date(raw.trim()));
  return undefined;
}

const UNIT_ALIASES: Record<string, string> = { min: "minute", hr: "hour" };

/** "3 days ago", "an hour ago", "Just posted", "yesterday". */
function parseRelative(t: string, now: Date): Date | null {
  if (/\b(just|today|now|few seconds|moments?)\b/.test(t)) return now;
  if (/\byesterday\b/.test(t)) return new Date(now.getTime() - UNIT_MS.day);
  const m = t.match(/(\d+|an?|one)\+?\s*(minute|min|hour|hr|day|week|month|year)s?\b/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  const unit = UNIT_ALIASES[m[2]] ?? m[2];
  return new Date(now.getTime() - n * UNIT_MS[unit]);
}

/**
 * Reads a posting date as the job boards give it: ISO dates, epoch numbers or
 * text like "3 days ago", "30+ days ago" and "Just posted". A date without a
 * time counts as the end of that day, so a job posted late yesterday is not
 * dropped from a 24-hour search. Returns null when it can't tell.
 */
export function parsePosted(value: unknown, now = new Date()): Date | null {
  if (typeof value === "number") return epochDate(value);
  if (typeof value !== "string") return null;
  const t = value.trim().toLowerCase();
  if (!t) return null;
  const absolute = parseAbsolute(t, value);
  return absolute === undefined ? parseRelative(t, now) : absolute;
}

// Allows for clock and timezone drift between the board and this machine.
const GRACE_MS = 2 * 36e5;

/** True only when the job states a posting date older than the window. Undated jobs pass. */
export function postedTooLongAgo(postedAt: string | undefined, days: PostedWithin, now = new Date()): boolean {
  const d = parsePosted(postedAt, now);
  return !!d && now.getTime() - d.getTime() > days * UNIT_MS.day + GRACE_MS;
}
