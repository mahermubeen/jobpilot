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

/**
 * Your salary answer for one field, by these rules:
 * the job states a range → its maximum, never below your floor;
 * a home-market job without a range → your target;
 * any other job without a range → the market rate (from the AI), never below your floor.
 * The amount is given in the currency and period the field asks for.
 */
export function resolveSalary(
  field: FormField,
  facts: ApplyFacts,
  job: SalaryJob,
  marketUsdYear?: number | null,
): SalaryResult {
  const kind = salaryQuestion(field.label);
  const s = facts.salary;
  if (!kind || !(s.target > 0) || !s.currency) return null;
  const toUsd = (monthly: number) => monthly * rate(s.currency);
  const floor = toUsd(s.floor > 0 ? s.floor : 0);
  const home = isHomeJob(job, facts);

  let usdMonth: number;
  if (kind === "current") {
    if (!(s.last > 0)) return null;
    usdMonth = toUsd(s.last);
  } else {
    const stated = statedMaxUsdMonth(job);
    if (stated) usdMonth = Math.max(stated, floor);
    else if (home) usdMonth = toUsd(s.target);
    else if (marketUsdYear && marketUsdYear > 0) usdMonth = Math.max(marketUsdYear / 12, floor);
    else return { needsMarket: true };
  }

  // What you earn now is in your own currency; what you ask for follows the job.
  const mine = kind === "current" || home;
  const currency =
    currencyIn(field.label) ??
    currencyIn(field.options?.join(" ")) ??
    (kind === "current" ? null : currencyIn(job.pay)) ??
    (mine ? s.currency : "USD");
  const period = periodIn(field.label) ?? periodIn(field.options?.join(" ") ?? "") ?? (currency === s.currency && mine ? "month" : "year");
  const amount = round(fromUsdMonth(usdMonth, currency, period), period);

  if (field.options?.length) {
    const picked = pickSalaryOption(field.options, usdMonth, currency, period);
    return picked ? { value: picked, usdMonth } : null;
  }
  if (field.type === "number") return { value: String(amount), usdMonth };
  // A label that already names the currency or period wants just the number.
  if (currencyIn(field.label) || periodIn(field.label)) return { value: String(amount), usdMonth };
  const per = period === "month" ? "per month" : period === "year" ? "per year" : "per hour";
  return { value: `${amount.toLocaleString("en-US")} ${currency} ${per}`, usdMonth };
}

/** The pay-range option that holds the amount, or the nearest one. */
function pickSalaryOption(options: string[], usdMonth: number, currency: string, period: Period): string | null {
  let best: { option: string; distance: number } | null = null;
  for (const option of options) {
    const withUnits = `${currencyIn(option) ? "" : currency + " "}${option}${periodIn(option) ? "" : " per " + period}`;
    const p = parsePay(withUnits.replace(/\+|and above|or more/gi, ` - ${Number.MAX_SAFE_INTEGER}`));
    if (p.kind !== "salary") continue;
    if (usdMonth >= p.minUsdMonth && usdMonth <= p.maxUsdMonth) return option;
    const distance = Math.min(Math.abs(usdMonth - p.minUsdMonth), Math.abs(usdMonth - p.maxUsdMonth));
    if (!best || distance < best.distance) best = { option, distance };
  }
  return best?.option ?? pickOption(options, "Negotiable");
}
