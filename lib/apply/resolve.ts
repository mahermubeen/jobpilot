import { estimateMarketSalary, answerFormFields } from "@/lib/ai/tasks";
import { metered, sumCalls, type AiCall } from "@/lib/ai/meter";
import type { Profile } from "@/lib/cv/types";
import type { ApplyFacts } from "@/lib/settings";
import { profileAnswer, validateAnswer, type AnswerSource, type FieldAnswer, type FormField, type SavedAnswer } from "./answers";
import { bankAnswer, type BankJob } from "./bank";
import { findAnswer, getLearned, isJobSpecific, learn, type LearnedAnswer, markUsed, questionKey } from "./learned";
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

type Resolved = { answers: FieldAnswer[]; stats: FillStats };

const emptyStats = (): FillStats => ({
  profile: 0, bank: 0, saved: 0, learned: 0, ai: 0, none: 0, skipped: 0,
  calls: [], aiCalls: 0, inTokens: 0, outTokens: 0, aiName: null,
});

/**
 * Fills one form page. Holds the answers found so far and which remembered
 * answers were used; each answer source is one method, cheapest first.
 */
class FormResolver {
  private readonly answers = new Map<string, FieldAnswer>();
  readonly usedLearned: string[] = [];
  private readonly needsMarket: FormField[] = [];
  private readonly byYou: LearnedAnswer[];
  private readonly anyRequired: boolean;

  constructor(
    private readonly input: ResolveInput,
    private readonly deps: Deps,
    private readonly learned: LearnedAnswer[],
  ) {
    this.byYou = learned.filter((e) => e.by === "you");
    this.anyRequired = input.fields.some((f) => f.required);
  }

  /**
   * AI tokens go to required questions. A form that marks nothing as required
   * gets every open question answered, so nothing is skipped by mistake.
   */
  needsAi = (f: FormField) => this.input.ai !== false && (!!this.input.forceAi || !this.anyRequired || !!f.required);

  private set(f: FormField, value: FieldAnswer["value"], source: AnswerSource, extra: { skip?: boolean; rule?: string } = {}) {
    this.answers.set(f.id, { id: f.id, value, source, ...(extra.skip ? { skip: true } : {}), ...(extra.rule ? { rule: extra.rule } : {}) });
  }

  private fromProfile(f: FormField): boolean {
    const value = validateAnswer(f, profileAnswer(f, this.input.profile));
    if (value === null) return false;
    this.set(f, value, "profile");
    return true;
  }

  private fromLearned(f: FormField, entries: LearnedAnswer[], source: AnswerSource): boolean {
    const hit = findAnswer(f, entries, this.input.job.id);
    if (!hit) return false;
    this.set(f, hit.value, source);
    this.usedLearned.push(hit.entry.id);
    return true;
  }

  private fromBank(f: FormField): boolean {
    const { profile, facts, job } = this.input;
    const bank = bankAnswer(f, { profile, facts, job });
    if (!bank) return false;
    if (bank.skip) {
      this.set(f, null, "bank", { skip: true, rule: bank.rule });
      return true;
    }
    if (bank.needsMarket) {
      this.needsMarket.push(f);
      return true;
    }
    const value = validateAnswer(f, bank.value, bank.maxWords);
    if (value === null) return false;
    this.set(f, value, "bank", { rule: bank.rule });
    return true;
  }

  private fromSaved(f: FormField): boolean {
    const mine = findAnswer(f, this.input.saved.map((s) => ({ ...s, scope: "all" })), this.input.job.id);
    if (!mine) return false;
    this.set(f, mine.value, "saved");
    return true;
  }

  /** Profile, then an answer you gave yourself (it beats the bank's guess), the bank, your saved answers, remembered answers. */
  answerFromKnown(f: FormField) {
    if (f.type === "file") return;
    const sources = [
      () => this.fromProfile(f),
      () => this.fromLearned(f, this.byYou, "saved"),
      () => this.fromBank(f),
      () => this.fromSaved(f),
      () => this.fromLearned(f, this.learned, "learned"),
    ];
    sources.some((tryAnswer) => tryAnswer());
  }

  /** The market rate: remembered from an earlier job, or worked out by the AI now and remembered. */
  private async marketUsdYear(market: string): Promise<{ usdYear: number | null; source: AnswerSource }> {
    const { job, facts } = this.input;
    const remembered = Number(findAnswer({ id: "market", label: market, type: "number" }, this.learned, job.id)?.value) || null;
    if (remembered || !this.needsMarket.some(this.needsAi)) return { usdYear: remembered, source: remembered ? "learned" : "ai" };
    const usdYear = await this.deps
      .estimateMarketSalary({
        role: job.role,
        company: job.company,
        location: job.location ?? null,
        mode: job.mode ?? null,
        years: facts.totalYears,
        candidateLocation: [facts.city, facts.country].filter(Boolean).join(", "),
      })
      .catch(() => null);
    if (usdYear) await learn([{ question: market, answer: String(usdYear), type: "number", scope: "all", by: "AI" }]);
    return { usdYear, source: "ai" };
  }

  /** Salary for a job with no stated range outside your home market: the market rate, asked once per role and place. */
  async answerSalaries() {
    if (!this.needsMarket.length) return;
    const { job, facts } = this.input;
    const market = `Market salary (USD per year): ${job.role} — ${job.location || job.mode || "remote"}`;
    const { usdYear, source } = await this.marketUsdYear(market);
    if (!usdYear) return;
    for (const f of this.needsMarket) {
      const r = resolveSalary(f, facts, job, usdYear);
      if (r && "value" in r) this.set(f, validateAnswer(f, r.value), source, { rule: "salary" });
    }
  }

  /** Whatever is left and worth tokens goes to the AI in one call per tier; every answer is remembered. */
  async askAi() {
    const { profile, job, saved, facts, fields } = this.input;
    const open = fields.filter((f) => f.type !== "file" && !this.answers.has(f.id) && this.needsAi(f));
    if (!open.length) return;
    const raw = await this.deps.answerFormFields({
      profile,
      job: { ...job, location: job.location ?? null, description: job.description ?? null, cover: job.cover ?? null },
      saved,
      fields: open,
      facts: factsText(facts),
    });
    const toLearn: Parameters<typeof learn>[0] = [];
    for (const f of open) {
      const value = validateAnswer(f, raw.get(f.id));
      this.set(f, value, value === null ? "none" : "ai");
      if (value !== null && questionKey(f.label)) {
        toLearn.push({ question: f.label, answer: value, type: f.type, scope: isJobSpecific(f, job.company) ? job.id : "all", by: "AI" });
      }
    }
    await learn(toLearn);
  }

  result(): Resolved {
    const { fields } = this.input;
    const files = new Set(fields.filter((f) => f.type === "file").map((f) => f.id));
    const answers = fields.map((f) => this.answers.get(f.id) ?? { id: f.id, value: null, source: "none" as const });
    const stats = emptyStats();
    for (const a of answers) {
      if (a.skip) stats.skipped++;
      else if (!files.has(a.id)) stats[a.source]++;
    }
    return { answers, stats };
  }
}

async function resolve(input: ResolveInput, deps: Deps): Promise<Resolved> {
  const resolver = new FormResolver(input, deps, await getLearned());
  for (const f of input.fields) resolver.answerFromKnown(f);
  await resolver.answerSalaries();
  await resolver.askAi();
  await markUsed(resolver.usedLearned);
  return resolver.result();
}
