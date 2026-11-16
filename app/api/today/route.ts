import { route } from "@/lib/api";
import { profileIsReady } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import { getProfile, getSettings, secretsStatus } from "@/lib/settings";
import { daysBetween, today } from "@/lib/util";

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
  const t = today();
  const count = (s: string) => jobs.filter((j) => j.status === s).length;
  const appliedPlus = jobs.filter((j) =>
    ["Applied", "Replied", "Interview", "Offer", "Rejected"].includes(j.status),
  ).length;
  const responded = jobs.filter((j) =>
    ["Replied", "Interview", "Offer", "Rejected"].includes(j.status),
  ).length;

  const attention = [
    ...jobs
      .filter((j) => j.status === "Interview")
      .map((j) => ({ kind: "interview", jobId: j.id, title: j.company, detail: j.next || j.role })),
    ...jobs
      .filter((j) => j.status === "Replied")
      .map((j) => ({ kind: "reply", jobId: j.id, title: j.company, detail: `Replied about ${j.role}` })),
    ...jobs
      .filter(
        (j) => j.followUp && j.followUp <= t && ["Applied", "Drafted", "Found"].includes(j.status),
      )
      .map((j) => ({ kind: "followup", jobId: j.id, title: j.company, detail: `Follow up on ${j.role}` })),
    ...jobs
      .filter((j) => j.status === "Applied" && j.applied && !j.followUp && daysBetween(j.applied) >= 7)
      .map((j) => ({
        kind: "quiet",
        jobId: j.id,
        title: j.company,
        detail: `No reply for ${daysBetween(j.applied!)} days`,
      })),
  ];

  return {
    setup: {
      done: settings.setupDone,
      profile: profileIsReady(profile),
      search: settings.search.titles.length > 0 && settings.search.locations.length > 0,
      apify: secrets.apifyToken,
      gmail: !!secrets.gmailUser && secrets.gmailAppPassword,
      ai: settings.ai.mode === "claude-cli" || secrets.anthropicKey,
    },
    name: profile.name,
    stats: {
      jobs: jobs.length,
      strong: jobs.filter((j) => j.fit === "Strong" && ["Found", "Drafted"].includes(j.status)).length,
      toReview: outbox.filter((o) => ["queued", "approved", "failed"].includes(o.status)).length,
      applied: appliedPlus,
      responses: responded,
      interviews: count("Interview"),
      offers: count("Offer"),
      responseRate: appliedPlus ? Math.round((responded / appliedPlus) * 100) : null,
      contacts: contacts.length,
      withEmail: contacts.filter((c) => c.email).length,
      withPhone: contacts.filter((c) => c.phone).length,
    },
    attention,
    schedule: settings.schedule,
  };
});
