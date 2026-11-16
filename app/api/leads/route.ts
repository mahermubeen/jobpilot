import { route } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { leadScore } from "@/lib/pipeline/lead-score";

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

  const group = <T extends { companyId: string | null }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      if (!r.companyId) continue;
      map.set(r.companyId, [...(map.get(r.companyId) ?? []), r]);
    }
    return map;
  };
  const contactsBy = group(contacts);
  const jobsBy = group(jobs);
  const callsBy = group(calls);
  const outboxBy = group(outbox);

  const leads = companies
    .map((c) => {
      const cJobs = (jobsBy.get(c.id) ?? []).map((j) => ({
        id: j.id,
        role: j.role,
        link: j.link,
        status: j.status,
        fit: j.fit,
        score: j.score,
        found: j.found,
        location: j.location,
        hasDraft: !!j.cvVariant,
      }));
      const cContacts = contactsBy.get(c.id) ?? [];
      return {
        ...c,
        contacts: cContacts,
        jobs: cJobs,
        calls: (callsBy.get(c.id) ?? []).sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        ),
        emails: (outboxBy.get(c.id) ?? []).map((o) => ({
          id: o.id,
          to: o.to,
          status: o.status,
          sentAt: o.sentAt,
          repliedAt: o.repliedAt,
        })),
        leadScore: leadScore({
          jobs: cJobs,
          contacts: cContacts,
          companyPhone: c.phone,
          openRoles: c.openRoles.length,
        }),
      };
    })
    .sort((a, b) => b.leadScore - a.leadScore || a.name.localeCompare(b.name));

  return { leads, orphanContacts: contacts.filter((c) => !c.companyId) };
});
