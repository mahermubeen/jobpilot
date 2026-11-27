import { estimateMarketSalary, answerFormFields } from "@/lib/ai/tasks";
import { metered, sumCalls, type AiCall } from "@/lib/ai/meter";
import type { Profile } from "@/lib/cv/types";
import type { ApplyFacts } from "@/lib/settings";
import { profileAnswer, validateAnswer, type AnswerSource, type FieldAnswer, type FormField, type SavedAnswer } from "./answers";
import { bankAnswer, type BankJob } from "./bank";
import { findAnswer, getLearned, isJobSpecific, learn, markUsed, questionKey } from "./learned";
import { resolveSalary } from "./salary";

export type FillStats = Record<AnswerSource, number> & {
  skipped: number;
  /** Every AI call this fill made, with the tokens each used. Empty when no AI was needed. */
  calls: AiCall[];
  aiCalls: number;
  inTokens: number;
  outTokens: number;
  /** The AIs that answered, e.g. "Google Gemini" or "OpenAI, Google Gemini". */
  aiName: string | null;
};

/** Your facts in a few lines, for the rare question that still goes to the AI. */
export function factsText(f: ApplyFacts): string {
  const lines = [
    f.city && `Lives in ${[f.city, f.region, f.country].filter(Boolean).join(", ")}`,
    f.nationality && `Nationality: ${f.nationality}`,
    f.authorizedCountries.length && `Authorised to work without sponsorship in: ${f.authorizedCountries.join(", ")}; needs sponsorship anywhere else`,
    f.totalYears && `Total professional experience: ${f.totalYears} years`,
    `Notice period: ${f.noticeDays} days`,
    `Open to: ${f.workModes.join(", ")}; ${f.employmentTypes.join(", ")}; relocation: ${f.relocate ? "yes" : "no"}; travel: ${f.travel ? "yes" : "no"}`,
    f.timezone && `Time zone: ${f.timezone}`,
    f.languages && `Languages: ${f.languages}`,
  ];
  return lines.filter(Boolean).join("\n");
}

type Deps = {
  answerFormFields: typeof answerFormFields;
  estimateMarketSalary: typeof estimateMarketSalary;
};

/**
 * Answers every field of one form page, cheapest source first: profile,
 * question bank, your saved answers, remembered answers, and only then the
 * AI. Every AI answer is remembered for next time.
 */
type ResolveInput = {
  profile: Profile;
  facts: ApplyFacts;
  saved: SavedAnswer[];
  job: BankJob & { id: string; company: string; role: string };
  fields: FormField[];
  /** false: answer only from what is already known (instant suggestions, no tokens). */
  ai?: boolean;
  /** Ask the AI about every open field, optional ones included ("Ask AI" on one field). */
  forceAi?: boolean;
};

export async function resolveAnswers(
  input: ResolveInput,
  deps: Deps = { answerFormFields, estimateMarketSalary },
): Promise<{ answers: FieldAnswer[]; stats: FillStats }> {
  const { result, calls } = await metered(() => resolve(input, deps));
  const sum = sumCalls(calls);
  result.stats.calls = calls;
  result.stats.aiCalls = sum.calls;
  result.stats.inTokens = sum.inTokens;
  result.stats.outTokens = sum.outTokens;
  result.stats.aiName = calls.length ? [...new Set(calls.map((c) => c.ai))].join(", ") : null;
  return result;
}

async function resolve(input: ResolveInput, deps: Deps): Promise<{ answers: FieldAnswer[]; stats: FillStats }> {
  const { profile, facts, saved, job, fields } = input;
  const answers = new Map<string, FieldAnswer>();
  const stats: FillStats = {
    profile: 0, bank: 0, saved: 0, learned: 0, ai: 0, none: 0, skipped: 0,
    calls: [], aiCalls: 0, inTokens: 0, outTokens: 0, aiName: null,
  };
  const learned = await getLearned();
  const byYou = learned.filter((e) => e.by === "you");
  // AI tokens go to required questions. A form that marks nothing as required
  // gets every open question answered, so nothing is skipped by mistake.
  const anyRequired = fields.some((f) => f.required);
  const needsAi = (f: FormField) => input.ai !== false && (!!input.forceAi || !anyRequired || !!f.required);
  const usedLearned: string[] = [];
  const needsMarket: FormField[] = [];
  const ctx = { profile, facts, job };
  const set = (f: FormField, value: FieldAnswer["value"], source: AnswerSource, skip = false, rule?: string) =>
    answers.set(f.id, { id: f.id, value, source, ...(skip ? { skip } : {}), ...(rule ? { rule } : {}) });

  for (const f of fields) {
    if (f.type === "file") continue;
    const fromProfile = validateAnswer(f, profileAnswer(f, profile));
    if (fromProfile !== null) {
      set(f, fromProfile, "profile");
      continue;
    }
    // An answer you gave yourself on an earlier form beats the bank's guess.
    const yours = findAnswer(f, byYou, job.id);
    if (yours) {
      set(f, yours.value, "saved");
      usedLearned.push(yours.entry.id);
      continue;
    }
    const bank = bankAnswer(f, ctx);
    if (bank?.skip) {
      set(f, null, "bank", true, bank.rule);
      continue;
    }
    if (bank?.needsMarket) {
      needsMarket.push(f);
      continue;
    }
    if (bank) {
      const v = validateAnswer(f, bank.value, bank.maxWords);
      if (v !== null) {
        set(f, v, "bank", false, bank.rule);
        continue;
      }
    }
    const mine = findAnswer(f, saved.map((s) => ({ ...s, scope: "all" })), job.id);
    if (mine) {
      set(f, mine.value, "saved");
      continue;
    }
    const remembered = findAnswer(f, learned, job.id);
    if (remembered) {
      set(f, remembered.value, "learned");
      usedLearned.push(remembered.entry.id);
    }
  }

  // Salary for a job with no stated range outside your home market: the market rate, asked once per role and place.
  if (needsMarket.length) {
    const market = `Market salary (USD per year): ${job.role} — ${job.location || job.mode || "remote"}`;
    const marketField: FormField = { id: "market", label: market, type: "number" };
    let usdYear = Number(findAnswer(marketField, learned, job.id)?.value) || null;
    // The figure was remembered from an earlier job, or worked out by the AI just now.
    const salarySource: AnswerSource = usdYear ? "learned" : "ai";
    if (!usdYear && needsMarket.some(needsAi)) {
      usdYear = await deps
        .estimateMarketSalary({ role: job.role, company: job.company, location: job.location ?? null, mode: job.mode ?? null, years: facts.totalYears, candidateLocation: [facts.city, facts.country].filter(Boolean).join(", ") })
        .catch(() => null);
      if (usdYear) await learn([{ question: market, answer: String(usdYear), type: "number", scope: "all", by: "AI" }]);
    }
    for (const f of needsMarket) {
      const r = usdYear ? resolveSalary(f, facts, job, usdYear) : null;
      if (r && "value" in r) set(f, validateAnswer(f, r.value), salarySource, false, "salary");
    }
  }

  const open = fields.filter((f) => f.type !== "file" && !answers.has(f.id) && needsAi(f));
  if (open.length) {
    const raw = await deps.answerFormFields(profile, { ...job, location: job.location ?? null, description: job.description ?? null, cover: job.cover ?? null }, saved, open, factsText(facts));
    const toLearn: Parameters<typeof learn>[0] = [];
    for (const f of open) {
      const value = validateAnswer(f, raw.get(f.id));
      set(f, value, value === null ? "none" : "ai");
      if (value !== null && questionKey(f.label)) {
        toLearn.push({ question: f.label, answer: value, type: f.type, scope: isJobSpecific(f, job.company) ? job.id : "all", by: "AI" });
      }
    }
    await learn(toLearn);
  }
  await markUsed(usedLearned);

  const out = fields.map((f) => answers.get(f.id) ?? { id: f.id, value: null, source: "none" as const });
  for (const a of out) {
    if (a.skip) stats.skipped++;
    else if (fields.find((f) => f.id === a.id)?.type !== "file") stats[a.source]++;
  }
  return { answers: out, stats };
}
