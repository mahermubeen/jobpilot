export type LeadInput = {
  jobs: { fit: string | null; status: string; found: string | null }[];
  contacts: { email: string | null; emailStatus: string | null; phone: string | null; optedOut: boolean }[];
  companyPhone: string | null;
  openRoles: number;
};

const CLOSED = new Set(["Rejected", "Skipped"]);

/**
 * 0-100: how worth contacting a company is right now.
 * Fit of its open jobs (40) + a way to email (25) + a way to call (15) +
 * number of open roles (15) + freshness (5).
 */
export function leadScore(lead: LeadInput, now = new Date()): number {
  const reachable = lead.contacts.filter((c) => !c.optedOut);
  if (lead.contacts.length && !reachable.length) return 0;

  const live = lead.jobs.filter((j) => !CLOSED.has(j.status));
  const fit = live.some((j) => j.fit === "Strong")
    ? 40
    : live.some((j) => j.fit === "Partial")
      ? 18
      : live.length
        ? 6
        : 0;

  const emails = reachable.filter((c) => c.email);
  const email = emails.some((c) => c.emailStatus === "verified")
    ? 25
    : emails.some((c) => c.emailStatus === "site")
      ? 20
      : emails.length
        ? 12
        : 0;

  const phone = lead.companyPhone || reachable.some((c) => c.phone) ? 15 : 0;
  const roles = Math.min(Math.max(lead.openRoles, live.length), 3) * 5;
  const fresh = live.some(
    (j) => j.found && now.getTime() - new Date(j.found).getTime() < 7 * 864e5,
  )
    ? 5
    : 0;

  return Math.min(100, fit + email + phone + roles + fresh);
}
