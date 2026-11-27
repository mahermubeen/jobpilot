import { and, eq, gte, ne, notInArray } from "drizzle-orm";
import { renderCv } from "@/lib/cv/pdf";
import { profileIsReady } from "@/lib/cv/types";
import { cvFileName } from "@/lib/cv/variant";
import { getDb, schema } from "@/lib/db";
import { sendMail } from "@/lib/mail/smtp";
import { getProfile, getSettings } from "@/lib/settings";
import { errorMessage, oneAtATime, today } from "@/lib/util";

export type SendCheck =
  | { ok: true }
  | { ok: false; reason: string; needsConfirm?: boolean };

export type SendFacts = {
  status: string;
  to: string;
  isFollowUp: boolean;
  sentToday: number;
  dailyCap: number;
  /** Another email to this address was already sent (ignoring this thread). */
  alreadySentToAddress: boolean;
  contactOptedOut: boolean;
  emailStatus: string | null;
  confirmedGuess: boolean;
};

/** The rules every outgoing email must pass. Pure, so it can be tested. */
export function checkSend(f: SendFacts): SendCheck {
  if (f.status === "sent") return { ok: false, reason: "This email was already sent." };
  if (f.status === "sending") return { ok: false, reason: "This email is being sent right now." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.to)) {
    return { ok: false, reason: "The recipient address is not a valid email." };
  }
  if (f.contactOptedOut) {
    return { ok: false, reason: "This contact asked not to be contacted." };
  }
  if (f.sentToday >= f.dailyCap) {
    return { ok: false, reason: `Daily limit of ${f.dailyCap} emails reached. Try again tomorrow or raise it in Settings.` };
  }
  if (f.alreadySentToAddress && !f.isFollowUp) {
    return { ok: false, reason: `You already emailed ${f.to}. Send a follow-up in that thread instead.` };
  }
  if (f.emailStatus === "guessed" && !f.confirmedGuess) {
    return {
      ok: false,
      needsConfirm: true,
      reason: "This address is a guess and may bounce. Confirm to send anyway.",
    };
  }
  return { ok: true };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function sentTodayCount(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.outbox.id })
    .from(schema.outbox)
    .where(and(eq(schema.outbox.status, "sent"), gte(schema.outbox.sentAt, startOfToday())));
  return rows.length;
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return today(d);
}

type Db = Awaited<ReturnType<typeof getDb>>;
type OutboxRow = typeof schema.outbox.$inferSelect;
type JobRow = typeof schema.jobs.$inferSelect;
type ContactRow = typeof schema.contacts.$inferSelect;
type Profile = Awaited<ReturnType<typeof getProfile>>;

const APPLIED_FROM = ["Found", "Drafted"];
const EMAILED_FROM = ["To contact", "Called"];

async function rowById<T>(rows: Promise<T[]> | null): Promise<T | undefined> {
  return rows ? (await rows)[0] : undefined;
}

/** Everything `checkSend` needs that lives in the database. */
async function sendFacts(db: Db, item: OutboxRow, opts: { confirmGuessed?: boolean }, dailyCap: number) {
  const [contact, priorToAddress, sentToday] = await Promise.all([
    rowById(item.contactId ? db.select().from(schema.contacts).where(eq(schema.contacts.id, item.contactId)) : null),
    db
      .select({ id: schema.outbox.id })
      .from(schema.outbox)
      .where(and(eq(schema.outbox.to, item.to), eq(schema.outbox.status, "sent"), ne(schema.outbox.id, item.id))),
    sentTodayCount(),
  ]);
  const facts: SendFacts = {
    status: item.status,
    to: item.to,
    isFollowUp: !!item.followUpOf,
    sentToday,
    dailyCap,
    alreadySentToAddress: priorToAddress.length > 0,
    contactOptedOut: !!contact?.optedOut,
    emailStatus: contact?.emailStatus ?? null,
    confirmedGuess: !!opts.confirmGuessed,
  };
  return { facts, contact };
}

/** Sends through Gmail and returns the message id. Follow-ups go in the same thread and don't attach the CV again. */
async function deliver(item: OutboxRow, profile: Profile, job: JobRow | undefined, original: OutboxRow | undefined) {
  const attachment = item.followUpOf
    ? undefined
    : { filename: cvFileName(profile, job?.role, job?.company), content: await renderCv(profile, item.cvVariant ?? job?.cvVariant) };
  const { messageId } = await sendMail({
    fromName: profile.name,
    to: item.to,
    subject: item.subject,
    text: item.body,
    attachment,
    inReplyTo: original?.messageId ?? undefined,
  });
  return messageId;
}

const setOutbox = (db: Db, id: string, values: Partial<OutboxRow>) =>
  db.update(schema.outbox).set({ ...values, updatedAt: new Date() }).where(eq(schema.outbox.id, id));

/** After a send: the job counts as applied and the contact as emailed, both with a follow-up date. */
async function recordOutreach(db: Db, { job, contact }: { job?: JobRow; contact?: ContactRow }, followUpDays: number, now: Date) {
  const followUp = addDays(followUpDays);
  if (job) {
    await db
      .update(schema.jobs)
      .set({ status: APPLIED_FROM.includes(job.status) ? "Applied" : job.status, applied: job.applied ?? today(), followUp, updatedAt: now })
      .where(eq(schema.jobs.id, job.id));
  }
  if (contact) {
    await db
      .update(schema.contacts)
      .set({ status: EMAILED_FROM.includes(contact.status) ? "Emailed" : contact.status, lastContacted: today(), nextFollowUp: followUp, updatedAt: now })
      .where(eq(schema.contacts.id, contact.id));
  }
}

/**
 * Sends one reviewed email with the tailored CV attached. Never retries by
 * itself: a failed send stays "failed" until the user presses Send again.
 */
export function sendOutboxItem(id: string, opts: { confirmGuessed?: boolean } = {}): Promise<SendCheck> {
  return oneSendAtATime(() => sendNow(id, opts));
}

// Sends run one at a time in this process, so two clicks cannot both pass the
// "already sent" and daily-cap checks before either is recorded.
const oneSendAtATime = oneAtATime();

/**
 * Marks the email "sending" only if nothing else has claimed it; false when it
 * is already sending or sent. One conditional update, so it holds across processes too.
 */
async function claim(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(schema.outbox)
    .set({ status: "sending", error: null, updatedAt: new Date() })
    .where(and(eq(schema.outbox.id, id), notInArray(schema.outbox.status, ["sent", "sending"])))
    .returning({ id: schema.outbox.id });
  return rows.length === 1;
}

async function sendNow(id: string, opts: { confirmGuessed?: boolean }): Promise<SendCheck> {
  const db = await getDb();
  const [item] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, id));
  if (!item) return { ok: false, reason: "This email no longer exists." };

  const [settings, profile] = await Promise.all([getSettings(), getProfile()]);
  if (!profileIsReady(profile)) return { ok: false, reason: "Add your CV in Settings before sending." };

  const { facts, contact } = await sendFacts(db, item, opts, settings.caps.dailySend);
  const check = checkSend(facts);
  if (!check.ok) return check;

  const [job, original] = await Promise.all([
    rowById(item.jobId ? db.select().from(schema.jobs).where(eq(schema.jobs.id, item.jobId)) : null),
    rowById(item.followUpOf ? db.select().from(schema.outbox).where(eq(schema.outbox.id, item.followUpOf)) : null),
  ]);
  if (!(await claim(db, id))) return { ok: false, reason: "This email is being sent right now." };

  let messageId: string;
  try {
    messageId = await deliver(item, profile, job, original);
  } catch (err) {
    const reason = `${errorMessage(err)} Check your Gmail Sent folder before sending again, in case it went out.`;
    await setOutbox(db, id, { status: "failed", error: reason });
    return { ok: false, reason };
  }
  // Delivered: from here on nothing may mark it "failed", or a second press would send it again.
  // If this write fails the row stays "sending", which checkSend also refuses to send.
  const now = new Date();
  await db.update(schema.outbox).set({ status: "sent", messageId, sentAt: now, updatedAt: now }).where(eq(schema.outbox.id, id));
  try {
    await recordOutreach(db, { job, contact }, settings.outreach.followUpDays, now);
  } catch (err) {
    // The email went out; only the job and contact status lag behind. Say so in the log rather than fail the send.
    console.error(`Sent ${id}, but could not update the job or contact: ${errorMessage(err)}`);
  }
  return { ok: true };
}
