import type { Profile } from "@/lib/cv/types";
import { truncate } from "@/lib/util";
import { profileText } from "./profile-text";
import { completeJson } from "./provider";

export type Fit = "Strong" | "Partial" | "Skip";

export type JobForScoring = {
  id: string;
  company: string;
  role: string;
  location: string | null;
  pay: string | null;
  description: string | null;
};

export type JobScore = {
  id: string;
  fit: Fit;
  score: number;
  flags: string[];
  reason: string;
};

const clampScore = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const asFit = (f: unknown, score: number): Fit =>
  f === "Strong" || f === "Partial" || f === "Skip"
    ? f
    : score >= 70
      ? "Strong"
      : score >= 40
        ? "Partial"
        : "Skip";

type Targets = { titles: string[]; locations: string[]; minPay?: string; homeCity?: string; homePlaces?: string[] };

const jobList = (jobs: JobForScoring[]) =>
  jobs
    .map(
      (j) =>
        `<job id="${j.id}">\nCompany: ${j.company}\nRole: ${j.role}\nLocation: ${j.location ?? "unknown"}\n` +
        `Pay: ${j.pay ?? "not stated"}\nDescription: ${truncate(j.description, 1800) || "not available"}\n</job>`,
    )
    .join("\n\n");

function hardRules(targets: Targets): string {
  return [
    targets.minPay &&
      `Minimum pay: ${targets.minPay}, converting other currencies. Mark a job "Skip" when its stated pay tops out below this, or when it is unpaid or equity-only. A job that states no pay is fine.`,
    targets.homeCity &&
      `Place: onsite and hybrid jobs are only acceptable in ${targets.homeCity}. Mark a job "Skip" when it needs regular office attendance in any other city.`,
    `Remote: a remote job is only acceptable when it hires from anywhere in the world${targets.homePlaces?.length ? ` or specifically in ${targets.homePlaces.join(" / ")}` : ""}. Mark a remote job "Skip" when it is limited to another country or region, for example a US city or state as its location, "Remote, US", "US-based", "EU only", "must reside in Canada", or a need for US work authorisation.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Everything that is the same for every batch comes first, so providers with
 * prompt caching read it from the cache; only <jobs> changes between batches.
 */
function stablePart(profile: Profile, targets: Targets): string {
  const rules = hardRules(targets);
  return `You are screening job postings for one candidate. Judge each job only on the facts given.

<candidate>
${profileText(profile)}
Looking for: ${targets.titles.join(", ") || "roles matching their experience"}
Can work from: ${targets.locations.join("; ") || "their home location or remote"}
</candidate>${rules ? `\n\n<hard_rules>\n${rules}\n</hard_rules>` : ""}

For each job decide:
- "fit": "Strong" (the candidate meets most must-haves and can legally and practically do the job from where they are), "Partial" (a real stretch on stack, seniority or location, but worth a look), or "Skip" (wrong field, clearly location-locked somewhere they cannot work, unpaid, or a very different level).
- "score": 0-100, how likely a recruiter is to shortlist this candidate.
- "flags": up to 3 short warnings a candidate should know before applying, for example "US citizens only", "Asks 8+ yrs", "Equity only". Empty list if none.
- "reason": one plain sentence naming the main match or mismatch.

The jobs to screen:
`;
}

function toScores(raw: unknown, jobs: JobForScoring[]): JobScore[] {
  const byId = new Map((Array.isArray(raw) ? (raw as Partial<JobScore>[]) : []).map((r) => [String(r.id), r]));
  return jobs.flatMap((j) => {
    const r = byId.get(j.id);
    if (!r) return [];
    const score = clampScore(r.score);
    return [
      {
        id: j.id,
        fit: asFit(r.fit, score),
        score,
        flags: (Array.isArray(r.flags) ? r.flags : []).map(String).slice(0, 3),
        reason: truncate(String(r.reason ?? ""), 240),
      },
    ];
  });
}

/** Scores a batch of jobs against the candidate in one call. */
export async function scoreJobs(profile: Profile, jobs: JobForScoring[], targets: Targets): Promise<JobScore[]> {
  if (!jobs.length) return [];
  const list = jobList(jobs);
  const stable = stablePart(profile, targets);
  const prompt = `${stable}
<jobs>
${list}
</jobs>

Reply with only a JSON array, one object per job, in the same order:
[{"id": "...", "fit": "Strong", "score": 82, "flags": [], "reason": "..."}]`;

  const raw = await completeJson<Partial<JobScore>[]>(prompt, "score", undefined, stable.length);
  return toScores(raw, jobs);
}
