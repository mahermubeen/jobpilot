import { parsePay, USD_PER } from "@/lib/pay";
import type { ApplyFacts } from "@/lib/settings";
import { pickOption, type FormField } from "./answers";

export type SalaryJob = {
  role: string;
  company?: string | null;
  pay?: string | null;
  description?: string | null;
  location?: string | null;
  mode?: string | null;
};

type Period = "month" | "year" | "hour";
const HOURS_PER_MONTH = 160;

/** "expected" for what you want, "current" for what you earn now, or null when it is not a pay question. */
export function salaryQuestion(label: string): "expected" | "current" | null {
  const l = label.toLowerCase();
  const pay = /salary|compensation|remuneration|\bctc\b|\bpay\b|hourly rate|\brate expectation|earnings|\bincome\b|package/;
  if (!pay.test(l)) return null;
  if (/payroll|pay ?slip|paypal|equal pay|pay transparency/.test(l)) return null;
  if (/\b(current|last|previous|present|most recent)\b[^?]*\b(salary|ctc|compensation|pay|package|income)/.test(l)) return "current";
  return "expected";
}

const CODES = Object.keys(USD_PER);

/** The currency a question or pay line names: a code, a symbol, or a word like lakh. */
export function currencyIn(text: string | null | undefined): string | null {
  const t = text ?? "";
  for (const c of CODES) if (new RegExp(`\\b${c}\\b`, "i").test(t)) return c;
  if (/₹|\blakhs?\b|\blpa\b/i.test(t)) return "INR";
  if (/€/.test(t)) return "EUR";
  if (/£/.test(t)) return "GBP";
  if (/₨|\brs\.?\s?\d|\brupees?\b/i.test(t)) return "PKR";
  if (/\$/.test(t)) return "USD";
  return null;
}

export function periodIn(text: string): Period | null {
  const t = text.toLowerCase();
  if (/\b(hour|hourly|per hr|\/hr)\b/.test(t)) return "hour";
  if (/\b(month|monthly|per month|\/mo|pm)\b/.test(t)) return "month";
  if (/\b(year|yearly|annual|annually|annum|p\.?a\.?|lpa|\/yr)\b/.test(t)) return "year";
  return null;
}

/** The highest pay the job states, in US dollars a month, from its pay line or a pay sentence in its description. */
export function statedMaxUsdMonth(job: SalaryJob): number | null {
  const lines = [job.pay ?? ""];
  for (const sentence of (job.description ?? "").split(/(?<=[.!?\n])\s+/)) {
    if (/salary|compensation|pay range|budget|\bctc\b|base pay|pay:/i.test(sentence) && /\d/.test(sentence)) lines.push(sentence);
  }
  for (const line of lines) {
    const p = parsePay(line);
    if (p.kind === "salary" && p.maxUsdMonth > 0) return p.maxUsdMonth;
  }
  return null;
}

/** Whether the job is in your home market: its location or pay names your city or country. */
export function isHomeJob(job: SalaryJob, facts: ApplyFacts): boolean {
  const where = `${job.location ?? ""} ${job.pay ?? ""}`.toLowerCase();
  const home = [facts.country, facts.city].map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (home.some((h) => where.includes(h))) return true;
  return !!facts.salary.currency && currencyIn(job.pay) === facts.salary.currency;
}

const rate = (c: string) => USD_PER[c] ?? 1;
const fromUsdMonth = (usdMonth: number, currency: string, period: Period) =>
  (usdMonth / rate(currency)) * (period === "year" ? 12 : period === "hour" ? 1 / HOURS_PER_MONTH : 1);

function round(amount: number, period: Period) {
  if (period === "hour") return Math.round(amount);
  const step = amount >= 100_000 ? 1000 : amount >= 10_000 ? 500 : 100;
  return Math.round(amount / step) * step;
}

export type SalaryResult =
  | { value: string; usdMonth: number }
  /** No stated range for a job outside your home market: ask the AI once for the market rate. */
  | { needsMarket: true }
  | null;

type SalaryKind = "expected" | "current";
type Salary = ApplyFacts["salary"];
/** The question, your salary facts, the job, and whether the job is in your home market. */
type SalaryCase = { kind: SalaryKind; s: Salary; job: SalaryJob; home: boolean };

const toUsd = (monthly: number, currency: string) => monthly * rate(currency);

/**
 * The amount to give, in US dollars a month: what you earn now for "current";
 * otherwise the job's stated maximum, your target at home, or the market rate,
 * never below your floor. `needsMarket` when the market rate is needed and unknown.
 */
function targetUsdMonth({ kind, s, job, home }: SalaryCase, marketUsdYear?: number | null): number | "needsMarket" | null {
  if (kind === "current") return s.last > 0 ? toUsd(s.last, s.currency) : null;
  const floor = toUsd(s.floor > 0 ? s.floor : 0, s.currency);
  const stated = statedMaxUsdMonth(job);
  if (stated) return Math.max(stated, floor);
  if (home) return toUsd(s.target, s.currency);
  return marketUsdYear && marketUsdYear > 0 ? Math.max(marketUsdYear / 12, floor) : "needsMarket";
}

/** The currency the field asks for. What you earn now is in your own currency; what you ask for follows the job. */
function answerCurrency(field: FormField, options: string, { kind, s, job, home }: SalaryCase): string {
  const named = currencyIn(field.label) ?? currencyIn(options) ?? (kind === "current" ? null : currencyIn(job.pay));
  return named ?? (kind === "current" || home ? s.currency : "USD");
}

/** The period the field asks for: named in it, else a month in your own currency at home, else a year. */
function answerPeriod(field: FormField, options: string, currency: string, { kind, s, home }: SalaryCase): Period {
  const named = periodIn(field.label) ?? periodIn(options);
  if (named) return named;
  return currency === s.currency && (kind === "current" || home) ? "month" : "year";
}

function answerUnits(field: FormField, c: SalaryCase): { currency: string; period: Period } {
  const options = field.options?.join(" ") ?? "";
  const currency = answerCurrency(field, options, c);
  return { currency, period: answerPeriod(field, options, currency, c) };
}

const PER: Record<Period, string> = { month: "per month", year: "per year", hour: "per hour" };

/** The answer text: an option, bare digits, or "120,000 USD per year". */
function salaryValue(field: FormField, usdMonth: number, currency: string, period: Period): string | null {
  if (field.options?.length) return pickSalaryOption(field.options, usdMonth, currency, period);
  const amount = round(fromUsdMonth(usdMonth, currency, period), period);
  // A number field, or a label that already names the currency or period, wants just the number.
  if (field.type === "number" || currencyIn(field.label) || periodIn(field.label)) return String(amount);
  return `${amount.toLocaleString("en-US")} ${currency} ${PER[period]}`;
}

/**
 * Your salary answer for one field, by these rules:
 * the job states a range → its maximum, never below your floor;
 * a home-market job without a range → your target;
 * any other job without a range → the market rate (from the AI), never below your floor.
 * The amount is given in the currency and period the field asks for.
 */
export function resolveSalary(field: FormField, facts: ApplyFacts, job: SalaryJob, marketUsdYear?: number | null): SalaryResult {
  const kind = salaryQuestion(field.label);
  const s = facts.salary;
  if (!kind || !(s.target > 0) || !s.currency) return null;
  const c: SalaryCase = { kind, s, job, home: isHomeJob(job, facts) };
  const usdMonth = targetUsdMonth(c, marketUsdYear);
  if (usdMonth === "needsMarket") return { needsMarket: true };
  if (usdMonth === null) return null;
  const { currency, period } = answerUnits(field, c);
  const value = salaryValue(field, usdMonth, currency, period);
  return value ? { value, usdMonth } : null;
}

/** A pay-range option read with the field's currency and period when it names none ("5000+" → 5000 and up). */
function optionPay(option: string, currency: string, period: Period) {
  const withUnits = `${currencyIn(option) ? "" : currency + " "}${option}${periodIn(option) ? "" : " per " + period}`;
  return parsePay(withUnits.replace(/\+|and above|or more/gi, ` - ${Number.MAX_SAFE_INTEGER}`));
}

/** The pay-range option that holds the amount, or the nearest one. */
function pickSalaryOption(options: string[], usdMonth: number, currency: string, period: Period): string | null {
  let best: { option: string; distance: number } | null = null;
  for (const option of options) {
    const p = optionPay(option, currency, period);
    if (p.kind !== "salary") continue;
    if (usdMonth >= p.minUsdMonth && usdMonth <= p.maxUsdMonth) return option;
    const distance = Math.min(Math.abs(usdMonth - p.minUsdMonth), Math.abs(usdMonth - p.maxUsdMonth));
    if (!best || distance < best.distance) best = { option, distance };
  }
  return best?.option ?? pickOption(options, "Negotiable");
}
