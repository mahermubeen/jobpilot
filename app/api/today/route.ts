import { missingSetup } from "@/lib/ai/catalog";
import { route } from "@/lib/api";
import { profileIsReady } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import { getProfile, getSettings, secretsStatus } from "@/lib/settings";
import { daysBetween, today } from "@/lib/util";

type Job = typeof schema.jobs.$inferSelect;

const APPLIED_OR_LATER = ["Applied", "Replied", "Interview", "Offer", "Rejected"];
const RESPONDED = ["Replied", "Interview", "Offer", "Rejected"];
const OPEN = ["Found", "Drafted"];
const UNSENT = ["queued", "approved", "failed"];
const QUIET_DAYS = 7;
const FOLLOW_UP_STATUSES = new Set(["Applied", "Drafted", "Found"]);

/** Jobs per status, in one pass. */
function statusCounts(jobs: Job[]): (statuses: string[]) => number {
  const counts = new Map<string, number>();
  for (const j of jobs) counts.set(j.status, (counts.get(j.status) ?? 0) + 1);
  return (statuses) => statuses.reduce((n, s) => n + (counts.get(s) ?? 0), 0);
}

/** Interviews, replies, follow-ups due and applications gone quiet, in that order. */
function attentionItems(jobs: Job[], t: string) {
  const item = (kind: string, detail: (j: Job) => string) => (j: Job) => ({ kind, jobId: j.id, title: j.company, detail: detail(j) });
  return [
    ...jobs.filter((j) => j.status === "Interview").map(item("interview", (j) => j.next || j.role)),
    ...jobs.filter((j) => j.status === "Replied").map(item("reply", (j) => `Replied about ${j.role}`)),
    ...jobs
      .filter((j) => j.followUp && j.followUp <= t && FOLLOW_UP_STATUSES.has(j.status))
      .map(item("followup", (j) => `Follow up on ${j.role}`)),
    ...jobs
      .filter((j) => j.status === "Applied" && j.applied && !j.followUp && daysBetween(j.applied) >= QUIET_DAYS)
      .map(item("quiet", (j) => `No reply for ${daysBetween(j.applied!)} days`)),
  ];
}

/** Everything the Today page shows, in one request. */
export const GET = route(async () => {
  const db = await getDb();
  const [jobs, outbox, contacts, settings, secrets, profile] = await Promise.all([
    db.select().from(schema.jobs),
    db.select().from(schema.outbox),
    db.select().from(schema.contacts),
    getSettings(),
    secretsStatus(),
    getProfile(),
  ]);
  const count = statusCounts(jobs);
  const appliedPlus = count(APPLIED_OR_LATER);
  const responded = count(RESPONDED);
  return {
    setup: {
      done: settings.setupDone,
      profile: profileIsReady(profile),
      search: settings.search.titles.length > 0 && settings.search.locations.length > 0,
      apify: secrets.apifyToken,
      gmail: !!secrets.gmailUser && secrets.gmailAppPassword,
      ai: settings.ai.chain.some((e) => e.enabled && !missingSetup(e, secrets)),
    },
    name: profile.name,
    stats: {
      jobs: jobs.length,
      strong: jobs.filter((j) => j.fit === "Strong" && OPEN.includes(j.status)).length,
      toReview: outbox.filter((o) => UNSENT.includes(o.status)).length,
      applied: appliedPlus,
      responses: responded,
      interviews: count(["Interview"]),
      offers: count(["Offer"]),
      responseRate: appliedPlus ? Math.round((responded / appliedPlus) * 100) : null,
      contacts: contacts.length,
      withEmail: contacts.filter((c) => c.email).length,
      withPhone: contacts.filter((c) => c.phone).length,
    },
    attention: attentionItems(jobs, today()),
    schedule: settings.schedule,
  };
});
