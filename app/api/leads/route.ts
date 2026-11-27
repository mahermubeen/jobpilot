import { route } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { leadScore } from "@/lib/pipeline/lead-score";

type Company = typeof schema.companies.$inferSelect;
type Contact = typeof schema.contacts.$inferSelect;
type Job = typeof schema.jobs.$inferSelect;
type Call = typeof schema.calls.$inferSelect;
type Email = typeof schema.outbox.$inferSelect;

/** Rows grouped by company id in one pass; rows without a company are left out. */
function byCompany<T extends { companyId: string | null }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.companyId) continue;
    const list = map.get(r.companyId);
    if (list) list.push(r);
    else map.set(r.companyId, [r]);
  }
  return map;
}

const leadJob = (j: Job) => ({
  id: j.id,
  role: j.role,
  link: j.link,
  status: j.status,
  fit: j.fit,
  score: j.score,
  found: j.found,
  location: j.location,
  hasDraft: !!j.cvVariant,
});

const leadEmail = (o: Email) => ({ id: o.id, to: o.to, status: o.status, sentAt: o.sentAt, repliedAt: o.repliedAt });

type Groups = { contacts: Map<string, Contact[]>; jobs: Map<string, Job[]>; calls: Map<string, Call[]>; emails: Map<string, Email[]> };

function toLead(c: Company, g: Groups) {
  const jobs = (g.jobs.get(c.id) ?? []).map(leadJob);
  const contacts = g.contacts.get(c.id) ?? [];
  return {
    ...c,
    contacts,
    jobs,
    calls: (g.calls.get(c.id) ?? []).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    emails: (g.emails.get(c.id) ?? []).map(leadEmail),
    leadScore: leadScore({ jobs, contacts, companyPhone: c.phone, openRoles: c.openRoles.length }),
  };
}

/** Companies with their people, open jobs and call history, best leads first. */
export const GET = route(async () => {
  const db = await getDb();
  const [companies, contacts, jobs, calls, outbox] = await Promise.all([
    db.select().from(schema.companies),
    db.select().from(schema.contacts),
    db.select().from(schema.jobs),
    db.select().from(schema.calls),
    db.select().from(schema.outbox),
  ]);
  const groups: Groups = { contacts: byCompany(contacts), jobs: byCompany(jobs), calls: byCompany(calls), emails: byCompany(outbox) };
  const leads = companies.map((c) => toLead(c, groups)).sort((a, b) => b.leadScore - a.leadScore || a.name.localeCompare(b.name));
  return { leads, orphanContacts: contacts.filter((c) => !c.companyId) };
});
