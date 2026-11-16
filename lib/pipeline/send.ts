import { and, eq, gte, ne } from "drizzle-orm";
import { renderCv } from "@/lib/cv/pdf";
import { profileIsReady } from "@/lib/cv/types";
import { cvFileName } from "@/lib/cv/variant";
import { getDb, schema } from "@/lib/db";
import { sendMail } from "@/lib/mail/smtp";
import { getProfile, getSettings } from "@/lib/settings";
import { errorMessage, today } from "@/lib/util";

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

/**
 * Sends one reviewed email with the tailored CV attached. Never retries by
 * itself: a failed send stays "failed" until the user presses Send again.
 */
export async function sendOutboxItem(
  id: string,
  opts: { confirmGuessed?: boolean } = {},
): Promise<SendCheck> {
  const db = await getDb();
  const [item] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, id));
  if (!item) return { ok: false, reason: "This email no longer exists." };

  const [settings, profile] = await Promise.all([getSettings(), getProfile()]);
  if (!profileIsReady(profile)) {
    return { ok: false, reason: "Add your CV in Settings before sending." };
  }

  const [contact] = item.contactId
    ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, item.contactId))
    : [];
  const priorToAddress = await db
    .select({ id: schema.outbox.id })
    .from(schema.outbox)
    .where(
      and(
        eq(schema.outbox.to, item.to),
        eq(schema.outbox.status, "sent"),
        ne(schema.outbox.id, item.id),
      ),
    );

  const check = checkSend({
    status: item.status,
    to: item.to,
    isFollowUp: !!item.followUpOf,
    sentToday: await sentTodayCount(),
    dailyCap: settings.caps.dailySend,
    alreadySentToAddress: priorToAddress.length > 0,
    contactOptedOut: !!contact?.optedOut,
    emailStatus: contact?.emailStatus ?? null,
    confirmedGuess: !!opts.confirmGuessed,
  });
  if (!check.ok) return check;

  const [job] = item.jobId
    ? await db.select().from(schema.jobs).where(eq(schema.jobs.id, item.jobId))
    : [];
  const [original] = item.followUpOf
    ? await db.select().from(schema.outbox).where(eq(schema.outbox.id, item.followUpOf))
    : [];

  await db
    .update(schema.outbox)
    .set({ status: "sending", error: null, updatedAt: new Date() })
    .where(eq(schema.outbox.id, id));

  try {
    // Follow-ups go in the same thread and don't need the CV attached again.
    const attachment = item.followUpOf
      ? undefined
      : {
          filename: cvFileName(profile, job?.role, job?.company),
          content: await renderCv(profile, item.cvVariant ?? job?.cvVariant),
        };
    const { messageId } = await sendMail({
      fromName: profile.name,
      to: item.to,
      subject: item.subject,
      text: item.body,
      attachment,
      inReplyTo: original?.messageId ?? undefined,
    });

    const now = new Date();
    await db
      .update(schema.outbox)
      .set({ status: "sent", messageId, sentAt: now, updatedAt: now })
      .where(eq(schema.outbox.id, id));

    if (job) {
      const applied = ["Found", "Drafted"].includes(job.status);
      await db
        .update(schema.jobs)
        .set({
          status: applied ? "Applied" : job.status,
          applied: job.applied ?? today(),
          followUp: addDays(settings.outreach.followUpDays),
          updatedAt: now,
        })
        .where(eq(schema.jobs.id, job.id));
    }
    if (contact) {
      await db
        .update(schema.contacts)
        .set({
          status: ["To contact", "Called"].includes(contact.status) ? "Emailed" : contact.status,
          lastContacted: today(),
          nextFollowUp: addDays(settings.outreach.followUpDays),
          updatedAt: now,
        })
        .where(eq(schema.contacts.id, contact.id));
    }
    return { ok: true };
  } catch (err) {
    const reason =
      `${errorMessage(err)} Check your Gmail Sent folder before sending again, ` +
      "in case it went out.";
    await db
      .update(schema.outbox)
      .set({ status: "failed", error: reason, updatedAt: new Date() })
      .where(eq(schema.outbox.id, id));
    return { ok: false, reason };
  }
}
