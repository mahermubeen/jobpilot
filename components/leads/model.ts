export type Contact = {
  id: string; companyId: string | null; company: string | null; name: string; title: string | null;
  email: string | null; emailStatus: string | null; phone: string | null; linkedin: string | null;
  timezone: string | null; status: string; optedOut: boolean; source: string | null; notes: string | null;
  lastContacted: string | null; nextFollowUp: string | null;
};
export type LeadJob = { id: string; role: string; link: string | null; status: string; fit: string | null; score: number | null; location: string | null; hasDraft: boolean };
export type Lead = {
  id: string; name: string; website: string | null; linkedin: string | null; size: string | null;
  industry: string | null; location: string | null; address: string | null; phone: string | null;
  about: string | null; stack: string | null; enrichedAt: string | null; leadScore: number;
  contacts: Contact[];
  jobs: LeadJob[];
  calls: { id: string; contactId: string | null; outcome: string; note: string | null; createdAt: string }[];
  emails: { id: string; to: string; status: string; sentAt: string | null; repliedAt: string | null }[];
};
export type LeadSettings = { settings: { outreach: { callScript: string } }; profile: { name: string; headline: string } };
export type Filters = { q: string; onlyEmail: boolean; onlyPhone: boolean; onlyOpen: boolean };
export type Calling = { lead: Lead; contact: Contact | null; phone: string };

const CLOSED = new Set(["Rejected", "Skipped"]);

/** A phone number as a dialler wants it: digits, with a leading + kept. */
export const dial = (phone: string) => {
  const t = phone.trim();
  const digits = t.replace(/[^\d]/g, "");
  return (t.startsWith("+") ? "+" : "") + digits;
};

export const emptyContact = (lead?: Lead): Partial<Contact> => ({
  name: "", title: "", company: lead?.name ?? "", companyId: lead?.id ?? null, email: "", emailStatus: "",
  phone: "", linkedin: "", timezone: "", status: "To contact", optedOut: false, notes: "",
});

export const openJobsOf = (lead: Lead) => lead.jobs.filter((j) => !CLOSED.has(j.status));

/** The first item with the highest key; ties keep list order (as a stable sort would). */
function maxBy<T>(list: T[], key: (x: T) => number | string): T | undefined {
  let best: T | undefined;
  for (const x of list) if (best === undefined || key(x) > key(best)) best = x;
  return best;
}

const searchText = (l: Lead) =>
  [l.name, l.industry, l.location, ...l.contacts.map((c) => `${c.name} ${c.title} ${c.email}`), ...l.jobs.map((j) => j.role)]
    .join(" ").toLowerCase();

const hasPhone = (l: Lead) => !!l.phone || l.contacts.some((c) => c.phone);

/** Each filter as a check; a lead is shown when every switched-on check passes. */
const CHECKS: { on: (f: Filters) => boolean; pass: (l: Lead) => boolean }[] = [
  { on: (f) => f.onlyOpen, pass: (l) => openJobsOf(l).length > 0 || l.contacts.length > 0 },
  { on: (f) => f.onlyEmail, pass: (l) => l.contacts.some((c) => c.email) },
  { on: (f) => f.onlyPhone, pass: hasPhone },
];

export function filterLeads(leads: Lead[], f: Filters): Lead[] {
  const checks = CHECKS.filter((c) => c.on(f));
  const needle = f.q.toLowerCase().trim();
  return leads.filter((l) => checks.every((c) => c.pass(l)) && (!needle || searchText(l).includes(needle)));
}

export function leadTotals(leads: Lead[]) {
  const contacts = leads.flatMap((l) => l.contacts);
  return {
    companies: leads.length,
    contacts: contacts.length,
    email: contacts.filter((c) => c.email).length,
    phone: leads.filter(hasPhone).length,
    emailed: leads.filter((l) => l.emails.some((e) => e.status === "sent")).length,
    calls: leads.reduce((n, l) => n + l.calls.length, 0),
    replies: leads.filter((l) => l.emails.some((e) => e.repliedAt)).length,
  };
}

/** What one table row shows: the best open role, who to email or call, and the last touch. */
export function leadReach(lead: Lead) {
  const openJobs = openJobsOf(lead);
  const phoneContact = lead.contacts.find((c) => c.phone && !c.optedOut) ?? null;
  return {
    openJobs,
    best: maxBy(openJobs, (j) => j.score ?? 0),
    emailContact: lead.contacts.find((c) => c.email && !c.optedOut),
    phoneContact,
    phone: phoneContact?.phone ?? lead.phone,
    lastCall: lead.calls[0],
    lastEmail: maxBy(lead.emails.filter((e) => e.sentAt), (e) => e.sentAt ?? ""),
  };
}
export type Reach = ReturnType<typeof leadReach>;

/** How the script greets them: a first name, or "there" for a shared inbox. */
const greeting = (contact: Contact | null) =>
  contact && !/team|inbox/i.test(contact.name) ? contact.name.split(" ")[0] : "there";

/** The call script with this lead's names filled in. */
export function callScript(cfg: LeadSettings | null, lead: Lead, contact: Contact | null): string {
  const job = openJobsOf(lead)[0];
  const first = greeting(contact);
  const headline = cfg?.profile.headline;
  return (cfg?.settings.outreach.callScript ?? "")
    .replaceAll("{contact}", first)
    .replaceAll("{me}", cfg?.profile.name || "[your name]")
    .replaceAll("{company}", lead.name)
    .replaceAll("{role}", job?.role ?? "an engineering role")
    .replaceAll("{pitch}", headline ? `I'm a ${headline}.` : "");
}
