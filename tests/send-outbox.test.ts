import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("@/lib/mail/smtp", () => mail);
vi.mock("@/lib/cv/pdf", () => ({ renderCv: vi.fn(async () => Buffer.from("%PDF-1.4")) }));

import type { Profile } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import { sendOutboxItem } from "@/lib/pipeline/send";
import { defaultSettings, saveProfile, saveSettings } from "@/lib/settings";

// A throwaway embedded database, so these tests never touch the real data/ folder.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-send-"));
process.env.JOBPILOT_DATA_DIR = tmp;
delete process.env.DATABASE_URL;

const profile = {
  name: "Avery Example",
  headline: "Software Engineer",
  email: "avery@example.com",
  phone: "+1 555 0100",
  location: "Springfield",
  links: [],
  summary: "",
  experience: [{ company: "Example Corp", title: "Engineer", location: "", start: "2020", end: "", bullets: ["Built things."] }],
  education: [],
  skills: [],
  projects: [],
} as unknown as Profile;

let n = 0;
async function approvedEmail() {
  const db = await getDb();
  const id = `t${++n}`;
  await db.insert(schema.jobs).values({ id: `job-${id}`, company: "Acme Widgets", role: "Engineer", status: "Drafted" });
  await db.insert(schema.contacts).values({ id: `c-${id}`, company: "Acme Widgets", name: "Jordan Lee", email: `jordan${n}@acmewidgets.test`, emailStatus: "verified" });
  await db.insert(schema.outbox).values({
    id: `o-${id}`, jobId: `job-${id}`, contactId: `c-${id}`, to: `jordan${n}@acmewidgets.test`, subject: "Hello", body: "Dear Jordan,\n\nHi.\n\nAvery", status: "approved",
  });
  return `o-${id}`;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  mail.sendMail.mockReset();
  mail.sendMail.mockResolvedValue({ messageId: "<m1@example.com>" });
  await saveProfile(profile);
  await saveSettings(defaultSettings);
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("sendOutboxItem", () => {
  it("sends an approved email once and records it", async () => {
    const id = await approvedEmail();
    expect(await sendOutboxItem(id)).toEqual({ ok: true });
    const db = await getDb();
    const [row] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, id));
    expect(row).toMatchObject({ status: "sent", messageId: "<m1@example.com>" });
    expect((await sendOutboxItem(id)).ok).toBe(false);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it("keeps a delivered email marked sent when the bookkeeping after it fails", async () => {
    const id = await approvedEmail();
    const db = await getDb();
    const update = db.update.bind(db);
    vi.spyOn(db, "update").mockImplementation(((table: unknown) => {
      if (table === schema.jobs) throw new Error("disk is full");
      return update(table as typeof schema.outbox);
    }) as typeof db.update);
    const result = await sendOutboxItem(id);
    vi.restoreAllMocks();
    const [row] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, id));
    // The email left: it must not read "failed", or pressing Send again would send it twice.
    expect(row.status).toBe("sent");
    expect(result.ok).toBe(true);
    expect((await sendOutboxItem(id)).ok).toBe(false);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it("sends once when Send is pressed twice at the same moment", async () => {
    const id = await approvedEmail();
    const results = await Promise.all([sendOutboxItem(id), sendOutboxItem(id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    const [row] = await (await getDb()).select().from(schema.outbox).where(eq(schema.outbox.id, id));
    expect(row.status).toBe("sent");
  });

  it("keeps to the daily cap when two emails are sent at once", async () => {
    const db = await getDb();
    // Today's sends so far, so only one more fits under a cap of (sent today + 1).
    const sentToday = (await db.select().from(schema.outbox).where(eq(schema.outbox.status, "sent"))).length;
    await saveSettings({ ...defaultSettings, caps: { ...defaultSettings.caps, dailySend: sentToday + 1 } });
    const [a, b] = [await approvedEmail(), await approvedEmail()];
    const results = await Promise.all([sendOutboxItem(a), sendOutboxItem(b)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it("marks the email failed when Gmail refuses it", async () => {
    const id = await approvedEmail();
    mail.sendMail.mockRejectedValueOnce(new Error("Invalid login."));
    const result = await sendOutboxItem(id);
    expect(result).toMatchObject({ ok: false });
    const [row] = await (await getDb()).select().from(schema.outbox).where(eq(schema.outbox.id, id));
    expect(row.status).toBe("failed");
  });
});
