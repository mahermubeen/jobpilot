import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";


const ai = vi.hoisted(() => ({
  scoreJobs: vi.fn(),
  draftApplication: vi.fn(),
  draftFollowUp: vi.fn(),
}));
vi.mock("@/lib/ai/tasks", () => ai);
vi.mock("@/lib/apply/research", () => ({ researchCompany: vi.fn(async () => ({ text: "", fresh: null })) }));
const mail = vi.hoisted(() => ({ findReplies: vi.fn() }));
vi.mock("@/lib/mail/imap", () => mail);
const web = vi.hoisted(() => ({ findWebsites: vi.fn(), scrapeSites: vi.fn() }));
vi.mock("@/lib/sources/contacts", async (orig) => ({ ...(await orig<object>()), ...web }));
const apollo = vi.hoisted(() => ({ hasApollo: vi.fn(async () => false), apolloCompany: vi.fn(), apolloPeople: vi.fn() }));
vi.mock("@/lib/sources/apollo", () => apollo);

import type { Profile } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import {
  checkReplies,
  draftFollowUps,
  draftForJob,
  draftStrongJobs,
  enrichCompanies,
  scoreNewJobs,
  storeJobs,
} from "@/lib/pipeline/steps";
import { defaultSettings } from "@/lib/settings";
import type { RawJob } from "@/lib/sources/types";

// A throwaway embedded database, so these tests never touch the real data/ folder.
// getDb() opens lazily, so setting this before the first call is enough.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-steps-"));
process.env.JOBPILOT_DATA_DIR = tmp;
delete process.env.DATABASE_URL;

const profile: Profile = {
  name: "Avery Example",
  headline: "Software Engineer",
  email: "avery@example.com",
  phone: "+1 555 0100",
  location: "Springfield",
  links: [],
  summary: "",
  experience: [{ company: "Example Corp", title: "Engineer", start: "2020", end: "", bullets: [] }],
  education: [],
  skills: [],
} as unknown as Profile;

const filter = { minPay: defaultSettings.search.minPay, dropUnpaid: true, homeCity: "", locations: [] };
const log = vi.fn();

const raw = (over: Partial<RawJob> = {}): RawJob => ({
  source: "Test board",
  kind: "listing",
  sourceId: `id-${Math.random()}`,
  company: "Acme Widgets",
  role: "Frontend Engineer",
  link: `https://jobs.example.com/${Math.random()}`,
  location: "Remote",
  description: "Build things.",
  pay: "",
  mode: "Remote",
  tier: "Remote",
  company_: {},
  ...over,
});

const draft = (subject = "Hello", body = "Letter body") => ({
  subject,
  body,
  pitch: { summary: "pitch" },
  cvVariant: { headline: "Engineer" },
});

async function db() {
  return getDb();
}

beforeEach(async () => {
  vi.clearAllMocks();
  apollo.hasApollo.mockResolvedValue(false);
  const d = await db();
  await d.delete(schema.outbox);
  await d.delete(schema.contacts);
  await d.delete(schema.jobs);
  await d.delete(schema.companies);
  await d.delete(schema.dismissedJobs);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("storeJobs", () => {
  it("saves new jobs with their company and recruiter, one company row per name", async () => {
    const n = await storeJobs(
      [
        raw({ role: "Frontend Engineer", recruiter: { name: "Robin Recruiter" } }),
        raw({ role: "Backend Engineer", company_: { website: "https://acme.example.com" } }),
      ],
      filter,
      log,
    );
    expect(n).toBe(2);
    const d = await db();
    const jobs = await d.select().from(schema.jobs);
    expect(jobs.map((j) => j.role).sort()).toEqual(["Backend Engineer", "Frontend Engineer"]);
    expect(jobs.every((j) => j.status === "Found" && j.companyId === jobs[0].companyId)).toBe(true);
    const companies = await d.select().from(schema.companies);
    expect(companies).toHaveLength(1);
    expect(companies[0].website).toBe("https://acme.example.com");
    const contacts = await d.select().from(schema.contacts);
    expect(contacts.map((c) => [c.name, c.title])).toEqual([["Robin Recruiter", "Job poster"]]);
  });

  it("skips jobs already saved and filters out unpaid ones", async () => {
    const first = raw();
    await storeJobs([first], filter, log);
    const n = await storeJobs([first, raw({ role: "Volunteer Developer" })], filter, log);
    expect(n).toBe(0);
    expect(await (await db()).select().from(schema.jobs)).toHaveLength(1);
  });

  it("gives a post signed by a handle no company", async () => {
    await storeJobs([raw({ company: "@someone", recruiter: { name: "@someone" } })], filter, log);
    const d = await db();
    const [job] = await d.select().from(schema.jobs);
    expect(job.companyId).toBeNull();
    expect(await d.select().from(schema.companies)).toHaveLength(0);
    expect(await d.select().from(schema.contacts)).toHaveLength(0);
  });

  it("merges saved duplicates, keeping the copy furthest along", async () => {
    const d = await db();
    const link = "https://jobs.example.com/same";
    await d.insert(schema.jobs).values([
      { id: "a", company: "Acme Widgets", role: "Engineer", link, status: "Applied", source: "Board A" },
      { id: "b", company: "Acme Widgets", role: "Engineer", link, status: "Found", source: "Board B" },
    ]);
    await storeJobs([], filter, log);
    const jobs = await d.select().from(schema.jobs);
    expect(jobs.map((j) => j.id)).toEqual(["a"]);
    expect(jobs[0].alsoOn).toEqual(["Board B"]);
  });
});

describe("scoreNewJobs", () => {
  it("writes each score back, skips Skip-fit jobs and merges flags", async () => {
    const d = await db();
    await d.insert(schema.jobs).values([
      { id: "j1", company: "Acme Widgets", role: "Engineer", flags: ["old"] },
      { id: "j2", company: "Beta Labs", role: "Engineer" },
    ]);
    ai.scoreJobs.mockResolvedValue([
      { id: "j1", fit: "Strong", score: 90, flags: ["new"], reason: "Good" },
      { id: "j2", fit: "Skip", score: 10, flags: [], reason: "Bad" },
      { id: "unknown", fit: "Strong", score: 99, flags: [], reason: "" },
    ]);
    expect(await scoreNewJobs(profile, defaultSettings, log)).toBe(2);
    const byId = new Map((await d.select().from(schema.jobs)).map((j) => [j.id, j]));
    expect(byId.get("j1")).toMatchObject({ fit: "Strong", score: 90, flags: ["old", "new"], notes: "Good", status: "Found" });
    expect(byId.get("j2")).toMatchObject({ fit: "Skip", status: "Skipped" });
  });

  it("stops at the first failed batch", async () => {
    const d = await db();
    await d.insert(schema.jobs).values(Array.from({ length: 15 }, (_, i) => ({ id: `j${i}`, company: `Co ${i}`, role: "Engineer" })));
    ai.scoreJobs.mockRejectedValue(new Error("model down"));
    expect(await scoreNewJobs(profile, defaultSettings, log)).toBe(0);
    expect(ai.scoreJobs).toHaveBeenCalledTimes(1);
  });
});

describe("enrichCompanies", () => {
  // rankEmails drops example.* addresses as junk, so scraped emails use the reserved .test domain.
  it("finds a website, saves site contacts and marks the company looked up", async () => {
    const d = await db();
    await d.insert(schema.companies).values({ id: "acme", name: "Acme Widgets" });
    web.findWebsites.mockResolvedValue(new Map([["Acme Widgets", "https://acmewidgets.test"]]));
    web.scrapeSites.mockResolvedValue(
      new Map([["acmewidgets.test", { domain: "acmewidgets.test", emails: ["jobs@acmewidgets.test", "jane.doe@acmewidgets.test"], phones: ["+1 555 0101"], linkedIns: [] }]]),
    );
    expect(await enrichCompanies(["acme"], log)).toBe(1);
    const [company] = await d.select().from(schema.companies);
    expect(company.website).toBe("https://acmewidgets.test");
    expect(company.phone).toBe("+1 555 0101");
    expect(company.enrichedAt).toBeInstanceOf(Date);
    const contacts = await d.select().from(schema.contacts);
    expect(contacts.map((c) => [c.name, c.email]).sort()).toEqual([
      ["Acme Widgets hiring team", "jobs@acmewidgets.test"],
      ["Jane Doe", "jane.doe@acmewidgets.test"],
    ]);
  });

  it("fills company gaps and adds people from Apollo when a key is saved", async () => {
    const d = await db();
    await d.insert(schema.companies).values({ id: "acme", name: "Acme Widgets", website: "https://acme.example.com", size: "50" });
    web.scrapeSites.mockResolvedValue(new Map());
    apollo.hasApollo.mockResolvedValue(true);
    apollo.apolloCompany.mockResolvedValue({ size: "999", industry: "Widgets", about: "", address: "", phone: "", linkedin: "" });
    apollo.apolloPeople.mockResolvedValue([
      { name: "Sam Lead", title: "CTO", email: "sam@acme.example.com", phone: "", linkedin: "" },
      { name: "Kim Hire", title: "Recruiter", email: "", phone: "", linkedin: "" },
    ]);
    await enrichCompanies(["acme"], log);
    const [company] = await d.select().from(schema.companies);
    expect(company).toMatchObject({ size: "50", industry: "Widgets" });
    const contacts = await d.select().from(schema.contacts);
    expect(contacts.map((c) => [c.name, c.emailStatus]).sort()).toEqual([
      ["Kim Hire", null],
      ["Sam Lead", "verified"],
    ]);
  });
});

describe("drafting", () => {
  async function jobWithContact(email: string | null) {
    const d = await db();
    await d.insert(schema.companies).values({ id: "acme", name: "Acme Widgets" });
    await d.insert(schema.jobs).values({ id: "j1", company: "Acme Widgets", role: "Engineer", companyId: "acme", fit: "Strong", score: 80 });
    if (email) await d.insert(schema.contacts).values({ id: "c1", companyId: "acme", company: "Acme Widgets", name: "Pat", email, emailStatus: "verified" });
    const [job] = await d.select().from(schema.jobs);
    return job;
  }

  it("keeps the draft on the job when there is nobody to email", async () => {
    ai.draftApplication.mockResolvedValue(draft());
    const job = await jobWithContact(null);
    expect(await draftForJob(job, profile)).toEqual({ queued: false });
    const [saved] = await (await db()).select().from(schema.jobs);
    expect(saved).toMatchObject({ status: "Drafted", cover: "Letter body" });
  });

  it("queues one Outbox email and rewrites it while unsent", async () => {
    const d = await db();
    ai.draftApplication.mockResolvedValueOnce(draft("First", "One")).mockResolvedValueOnce(draft("Second", "Two"));
    const job = await jobWithContact("pat@acme.example.com");
    expect(await draftForJob(job, profile)).toEqual({ queued: true });
    expect(await draftForJob(job, profile)).toEqual({ queued: false });
    const outbox = await d.select().from(schema.outbox);
    expect(outbox.map((o) => [o.to, o.subject, o.body, o.status])).toEqual([["pat@acme.example.com", "Second", "Two", "queued"]]);
  });

  it("drafts Strong jobs without a CV selection, best score first", async () => {
    ai.draftApplication.mockResolvedValue(draft());
    await jobWithContact("pat@acme.example.com");
    expect(await draftStrongJobs(profile, 5, log)).toBe(1);
    expect(log).toHaveBeenCalledWith("Wrote 1 applications (1 waiting in Outbox)");
  });
});

describe("replies and follow-ups", () => {
  async function sentEmail(daysAgo: number, jobStatus = "Applied") {
    const d = await db();
    await d.insert(schema.jobs).values({ id: "j1", company: "Acme Widgets", role: "Engineer", status: jobStatus });
    await d.insert(schema.contacts).values({ id: "c1", company: "Acme Widgets", name: "Pat", email: "pat@acme.example.com", status: "Emailed" });
    await d.insert(schema.outbox).values({
      id: "o1", jobId: "j1", contactId: "c1", to: "pat@acme.example.com", subject: "Hi", body: "Body", status: "sent",
      sentAt: new Date(Date.now() - daysAgo * 864e5),
    });
  }

  it("marks a replied thread, its job and its contact", async () => {
    await sentEmail(1);
    mail.findReplies.mockResolvedValue(new Set(["pat@acme.example.com"]));
    expect(await checkReplies(log)).toBe(1);
    const d = await db();
    const [o] = await d.select().from(schema.outbox);
    expect(o.repliedAt).toBeInstanceOf(Date);
    expect((await d.select().from(schema.jobs))[0].status).toBe("Replied");
    expect((await d.select().from(schema.contacts))[0].status).toBe("Replied");
  });

  it("drafts a follow-up once it is due, and not for closed jobs", async () => {
    ai.draftFollowUp.mockResolvedValue({ subject: "Re: Hi", body: "Following up" });
    await sentEmail(30);
    expect(await draftFollowUps(profile, defaultSettings, log)).toBe(1);
    const d = await db();
    const follow = (await d.select().from(schema.outbox)).find((o) => o.followUpOf === "o1");
    expect(follow).toMatchObject({ subject: "Re: Hi", status: "queued", to: "pat@acme.example.com" });
    // Already has a follow-up: nothing more.
    expect(await draftFollowUps(profile, defaultSettings, log)).toBe(0);
  });

  it("writes no follow-up for a job that moved on", async () => {
    ai.draftFollowUp.mockResolvedValue({ subject: "Re: Hi", body: "Following up" });
    await sentEmail(30, "Interview");
    expect(await draftFollowUps(profile, defaultSettings, log)).toBe(0);
    expect(ai.draftFollowUp).not.toHaveBeenCalled();
  });

  it("never sends anything itself", async () => {
    ai.draftFollowUp.mockResolvedValue({ subject: "Re: Hi", body: "Following up" });
    await sentEmail(30);
    await draftFollowUps(profile, defaultSettings, log);
    const d = await db();
    const queued = await d.select().from(schema.outbox).where(eq(schema.outbox.status, "sent"));
    expect(queued.map((o) => o.id)).toEqual(["o1"]);
  });
});
