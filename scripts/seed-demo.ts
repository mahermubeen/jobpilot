/**
 * Fills an EMPTY database with fictional demo data, for screenshots or to try
 * the app without any keys. Every company, person and email here is made up.
 *
 *   JOBPILOT_DATA_DIR=./demo-data npx tsx scripts/seed-demo.ts
 *   JOBPILOT_DATA_DIR=./demo-data npm run dev
 *
 * It refuses to run without JOBPILOT_DATA_DIR, against DATABASE_URL, or on a
 * database that already has jobs, so it can never touch your real data.
 */
import { getDb, schema } from "../lib/db";
import { defaultSettings, saveProfile, saveSecrets, saveSettings } from "../lib/settings";
import { emptyProfile, type Profile } from "../lib/cv/types";

const PROFILE: Profile = {
  ...emptyProfile,
  name: "Alex Doe",
  headline: "Full Stack Engineer · React, Node.js, AI features",
  email: "alex@example.com",
  phone: "+1 555 0100",
  location: "Remote",
  summary: "Full stack engineer who ships product features end to end, from UI to APIs to LLM integrations.",
  experience: [
    { company: "Acme Corp", title: "Senior Full Stack Engineer", location: "Remote", start: "Jan 2023", end: "Present", bullets: ["Built an AI support assistant used by 40k customers.", "Cut page load times by 35% with server rendering."] },
    { company: "Globex", title: "Software Engineer", location: "Remote", start: "Jun 2020", end: "Dec 2022", bullets: ["Shipped real-time chat for a mobile app with 1M users."] },
  ],
  skills: [{ category: "Core", items: ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL", "LLM APIs"] }],
  education: [{ school: "Example University", degree: "BS Computer Science", start: "2016", end: "2020" }],
};

const COMPANIES = [
  { id: "brightloop", name: "Brightloop", website: "https://brightloop.example", size: "51-200", industry: "Developer tools", location: "Remote", region: "US" },
  { id: "kestrel-health", name: "Kestrel Health", website: "https://kestrel.example", size: "201-500", industry: "Health tech", location: "Austin, TX", region: "US" },
  { id: "tidewater", name: "Tidewater Analytics", website: "https://tidewater.example", size: "11-50", industry: "Data", location: "Remote", region: "EU" },
  { id: "orbitline", name: "Orbitline", website: "https://orbitline.example", size: "51-200", industry: "Logistics", location: "Berlin", region: "EU" },
  { id: "quillstack", name: "Quillstack", website: "https://quillstack.example", size: "11-50", industry: "AI writing", location: "Remote", region: "US" },
];

const JOBS = [
  { company: "Brightloop", role: "Senior Full Stack Engineer", status: "Found", fit: "Strong", score: 91, mode: "Remote", location: "Remote, US", pay: "$140k – $170k", source: "linkedin", flags: [] },
  { company: "Quillstack", role: "AI Product Engineer", status: "Found", fit: "Strong", score: 88, mode: "Remote", location: "Remote", pay: "$130k – $160k", source: "greenhouse", flags: [] },
  { company: "Tidewater Analytics", role: "Frontend Engineer (React)", status: "Found", fit: "Partial", score: 67, mode: "Remote", location: "Remote, EU", pay: "€70k – €85k", source: "lever", flags: ["EU timezone overlap"] },
  { company: "Orbitline", role: "Backend Engineer, Node.js", status: "Found", fit: "Skip", score: 32, mode: "Onsite", location: "Berlin", pay: null, source: "indeed", flags: ["Onsite only", "German required"] },
  { company: "Kestrel Health", role: "Full Stack Engineer", status: "Drafted", fit: "Strong", score: 84, mode: "Hybrid", location: "Austin, TX", pay: "$125k – $150k", source: "ashby", flags: [] },
  { company: "Quillstack", role: "Senior TypeScript Engineer", status: "Drafted", fit: "Strong", score: 86, mode: "Remote", location: "Remote", pay: "$150k", source: "linkedin", flags: [] },
  { company: "Brightloop", role: "Platform Engineer", status: "Applied", fit: "Partial", score: 72, mode: "Remote", location: "Remote, US", pay: "$135k – $155k", source: "greenhouse", flags: [] },
  { company: "Tidewater Analytics", role: "Software Engineer, Data Apps", status: "Applied", fit: "Strong", score: 81, mode: "Remote", location: "Remote, EU", pay: "€80k", source: "workable", flags: [] },
  { company: "Kestrel Health", role: "Senior Frontend Engineer", status: "Replied", fit: "Strong", score: 89, mode: "Remote", location: "Remote, US", pay: "$145k", source: "linkedin", flags: [] },
  { company: "Orbitline", role: "Full Stack Engineer, Tracking", status: "Interview", fit: "Strong", score: 90, mode: "Remote", location: "Remote, EU", pay: "€85k – €95k", source: "lever", flags: [] },
];

const CONTACTS = [
  { id: "c1", companyId: "brightloop", company: "Brightloop", name: "Jordan Lee", title: "Head of Engineering", email: "jordan@brightloop.example", emailStatus: "verified" },
  { id: "c2", companyId: "kestrel-health", company: "Kestrel Health", name: "Sam Rivera", title: "Engineering Manager", email: "sam@kestrel.example", emailStatus: "verified", status: "Replied" },
  { id: "c3", companyId: "quillstack", company: "Quillstack", name: "Taylor Kim", title: "CTO", email: "taylor@quillstack.example", emailStatus: "guessed" },
  { id: "c4", companyId: "orbitline", company: "Orbitline", name: "Morgan Ellis", title: "Talent Partner", email: "morgan@orbitline.example", emailStatus: "verified", status: "Meeting" },
];

const DRAFTS = [
  { id: "o1", jobId: "demo-5", contactId: "c2", companyId: "kestrel-health", to: "sam@kestrel.example", subject: "I'd build your patient intake assistant | Full Stack Engineer", body: "Dear Sam,\n\nThe problem: new patients at Kestrel fill in the same intake details three times, and staff retype them into the EHR.\n\nMy approach: a guided intake assistant that asks once, checks answers as you go and writes a clean record your staff confirm in one click.\n\nAbout me: 6 years shipping React and Node.js products, including an AI support assistant used by 40k customers.\n\nCould I show you a 10-minute prototype?\n\nAlex Doe", status: "queued" },
  { id: "o2", jobId: "demo-6", contactId: "c3", companyId: "quillstack", to: "taylor@quillstack.example", subject: "Faster drafts for your editors | Senior TypeScript Engineer", body: "Dear Taylor,\n\nThe problem: Quillstack editors wait on slow drafts when documents get long.\n\nMy approach: stream drafts section by section and cache shared context, so the first words appear in under a second.\n\nAbout me: I build TypeScript products end to end and have shipped LLM features to production.\n\nCould I walk you through it in a 10-minute call?\n\nAlex Doe", status: "approved" },
];

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Stops unless this is a fresh demo data folder, so real data is never touched. */
async function assertEmptyDemoDb() {
  if (!process.env.JOBPILOT_DATA_DIR || process.env.DATABASE_URL) {
    console.error("Set JOBPILOT_DATA_DIR to a new, empty folder (and unset DATABASE_URL).");
    process.exit(1);
  }
  const db = await getDb();
  if ((await db.select({ id: schema.jobs.id }).from(schema.jobs).limit(1)).length) {
    console.error("This database already has jobs. Use a new, empty JOBPILOT_DATA_DIR.");
    process.exit(1);
  }
  return db;
}

async function seedSettings() {
  await saveProfile(PROFILE);
  await saveSettings({
    ...defaultSettings,
    setupDone: true,
    schedule: { ...defaultSettings.schedule, enabled: false },
    search: {
      ...defaultSettings.search,
      titles: ["Full Stack Engineer", "AI Engineer"],
      locations: [{ label: "Worldwide remote", linkedin: "Worldwide", indeedCountry: "", indeedLocation: "", remote: true }],
    },
  });
  // Placeholder mail login so the setup banner is hidden. It can't sign in to anything.
  await saveSecrets({ gmailUser: "alex@example.com", gmailAppPassword: "demo-only" });
}

const APPLIED = new Set(["Applied", "Replied", "Interview"]);
const companyIds = new Map(COMPANIES.map((c) => [c.name, c.id]));

/** Each demo job as a stored row, with its company, found date and applied date. */
const jobRows = () =>
  JOBS.map((j, i) => ({
    ...j,
    id: `demo-${i + 1}`,
    link: `https://jobs.example/${i + 1}`,
    companyId: companyIds.get(j.company) ?? null,
    found: day(i % 5),
    applied: APPLIED.has(j.status) ? day(6 + i) : null,
    description: `${j.role} at ${j.company}. Fictional demo listing.`,
  }));

async function main() {
  const db = await assertEmptyDemoDb();
  await seedSettings();
  await db.insert(schema.companies).values(COMPANIES);
  await db.insert(schema.jobs).values(jobRows());
  await db.insert(schema.contacts).values(CONTACTS);
  await db.insert(schema.outbox).values(DRAFTS);
  console.log(`Seeded ${JOBS.length} jobs, ${COMPANIES.length} companies, ${CONTACTS.length} contacts and ${DRAFTS.length} drafts.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
