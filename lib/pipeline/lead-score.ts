export type LeadInput = {
  jobs: { fit: string | null; status: string; found: string | null }[];
  contacts: { email: string | null; emailStatus: string | null; phone: string | null; optedOut: boolean }[];
  companyPhone: string | null;
  openRoles: number;
};

const CLOSED = new Set(["Rejected", "Skipped"]);

const WEEK_MS = 7 * 864e5;

type Job = LeadInput["jobs"][number];
type Contact = LeadInput["contacts"][number];

/** The first matching tier's points, else `none`. */
const tiered = <T>(items: T[], tiers: [(item: T) => boolean, number][], none: number) =>
  tiers.find(([test]) => items.some(test))?.[1] ?? none;

const fitPoints = (live: Job[]) =>
  tiered(live, [[(j) => j.fit === "Strong", 40], [(j) => j.fit === "Partial", 18], [() => true, 6]], 0);

const emailPoints = (emails: Contact[]) =>
  tiered(emails, [[(c) => c.emailStatus === "verified", 25], [(c) => c.emailStatus === "site", 20], [() => true, 12]], 0);

const freshPoints = (live: Job[], now: Date) =>
  live.some((j) => j.found && now.getTime() - new Date(j.found).getTime() < WEEK_MS) ? 5 : 0;

/**
 * 0-100: how worth contacting a company is right now.
 * Fit of its open jobs (40) + a way to email (25) + a way to call (15) +
 * number of open roles (15) + freshness (5).
 */
export function leadScore(lead: LeadInput, now = new Date()): number {
  const reachable = lead.contacts.filter((c) => !c.optedOut);
  if (lead.contacts.length && !reachable.length) return 0;
  const live = lead.jobs.filter((j) => !CLOSED.has(j.status));
  const phone = lead.companyPhone || reachable.some((c) => c.phone) ? 15 : 0;
  const roles = Math.min(Math.max(lead.openRoles, live.length), 3) * 5;
  const email = emailPoints(reachable.filter((c) => c.email));
  return Math.min(100, fitPoints(live) + email + phone + roles + freshPoints(live, now));
}
