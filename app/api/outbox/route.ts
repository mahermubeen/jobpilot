import { desc, eq } from "drizzle-orm";
import { HttpError, route } from "@/lib/api";
import { draftApplication } from "@/lib/ai/tasks";
import { profileIsReady } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import { sentTodayCount } from "@/lib/pipeline/send";
import { getProfile, getSettings } from "@/lib/settings";
import { uid } from "@/lib/util";

export const GET = route(async () => {
  const db = await getDb();
  const [items, jobs, contacts, settings, sentToday] = await Promise.all([
    db.select().from(schema.outbox).orderBy(desc(schema.outbox.createdAt)),
    db.select().from(schema.jobs),
    db.select().from(schema.contacts),
    getSettings(),
    sentTodayCount(),
  ]);
  const jobBy = new Map(jobs.map((j) => [j.id, j]));
  const contactBy = new Map(contacts.map((c) => [c.id, c]));
  return {
    sentToday,
    dailyCap: settings.caps.dailySend,
    items: items.map((o) => {
      const job = o.jobId ? jobBy.get(o.jobId) : undefined;
      const contact = o.contactId ? contactBy.get(o.contactId) : undefined;
      return {
        ...o,
        job: job && { id: job.id, company: job.company, role: job.role, link: job.link, fit: job.fit },
        contact: contact && {
          id: contact.id,
          name: contact.name,
          title: contact.title,
          emailStatus: contact.emailStatus,
          optedOut: contact.optedOut,
        },
      };
    }),
  };
});

/** Writes a new email to a contact, about one of the company's jobs when there is one. */
export const POST = route(async (req: Request) => {
  const { contactId, jobId } = (await req.json()) as { contactId: string; jobId?: string };
  const db = await getDb();
  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
  if (!contact) throw new HttpError(404, "Contact not found.");
  if (!contact.email) throw new HttpError(400, "This contact has no email address.");
  if (contact.optedOut) throw new HttpError(400, "This contact asked not to be contacted.");

  const profile = await getProfile();
  if (!profileIsReady(profile)) throw new HttpError(400, "Add your CV in Settings first.");

  const companyJobs = contact.companyId
    ? await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, contact.companyId))
    : [];
  const job =
    companyJobs.find((j) => j.id === jobId) ??
    companyJobs
      .filter((j) => !["Rejected", "Skipped"].includes(j.status))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  if (!job) {
    throw new HttpError(400, "Add a job for this company first, so the email has a role to apply for.");
  }

  const draft = await draftApplication(
    profile,
    { company: job.company, role: job.role, location: job.location, description: job.description ?? job.notes },
    contact,
  );
  const id = uid();
  await db.insert(schema.outbox).values({
    id,
    jobId: job.id,
    contactId: contact.id,
    companyId: contact.companyId,
    to: contact.email,
    subject: draft.subject,
    body: draft.body,
    cvVariant: draft.cvVariant,
  });
  if (!job.cvVariant) {
    await db
      .update(schema.jobs)
      .set({
        cvVariant: draft.cvVariant,
        cover: job.cover || draft.body,
        status: job.status === "Found" ? "Drafted" : job.status,
        updatedAt: new Date(),
      })
      .where(eq(schema.jobs.id, job.id));
  }
  return { id };
});
