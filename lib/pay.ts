/**
 * Reads the free-text pay line of a job listing ("$72k–$108k", "₹12–14 LPA",
 * "PKR 150k–400k/mo", "1% equity") into something comparable.
 */

// Approximate US dollars per unit. Good enough to compare against a minimum;
// update here if rates drift a lot.
export const USD_PER: Record<string, number> = {
  USD: 1,
  PKR: 1 / 280,
  INR: 1 / 85,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.73,
  AUD: 0.66,
  AED: 0.272,
};

export const CURRENCIES = Object.keys(USD_PER);

export type MinPay = { amount: number; currency: string; period: "month" | "year" };

export type Pay =
  | { kind: "salary"; minUsdMonth: number; maxUsdMonth: number }
  | { kind: "equity" }
  | { kind: "unpaid" }
  | { kind: "unknown" };

const SYMBOLS: [RegExp, string][] = [
  [/₹/, "INR"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/₨|\brs\.?(?![a-z])/, "PKR"],
  [/\$/, "USD"],
];

const MULTIPLIER: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  l: 1e5,
  lakh: 1e5,
  lakhs: 1e5,
  lpa: 1e5,
  cr: 1e7,
};

// Units of the stated period per month.
function perMonth(text: string, currency: string): number | null {
  if (/\b(hr|hour|hourly)\b/.test(text)) return 160;
  if (/\b(day|daily)\b/.test(text)) return 22;
  if (/\b(wk|week|weekly)\b/.test(text)) return 4.33;
  if (/\b(mo|month|monthly|pm)\b/.test(text)) return 1;
  if (/\b(yr|year|yearly|annum|annual|annually|pa|lpa)\b/.test(text)) return 1 / 12;
  // A one-off fee is not a salary.
  if (/\b(freelance|project|fixed|one-off|milestone)\b/.test(text)) return null;
  return currency === "PKR" ? 1 : 1 / 12;
}

type Amount = { value: number; unit: string };

/** Amounts with their unit (k, lakh…), ignoring percentages such as "0.5%-1% equity". */
function amountsIn(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lpa|cr|k|m|l)?(?![a-z\d])(\s*%)?/g)) {
    const value = Number(m[1].replace(/,/g, ""));
    if (!m[3] && value > 0) out.push({ value, unit: m[2] ?? "" });
  }
  return out;
}

const currencyOf = (text: string) =>
  CURRENCIES.find((c) => new RegExp(`\\b${c.toLowerCase()}\\b`).test(text)) ?? SYMBOLS.find(([re]) => re.test(text))?.[1];

/** "$3-5k" and "₹12-14 LPA": a bare first number takes the unit of the second. */
function salaryRange([a, b = a]: Amount[], currency: string, months: number): Pay {
  const unitA = a.unit || b.unit;
  const toUsdMonth = (value: number, unit: string) => value * (MULTIPLIER[unit] ?? 1) * USD_PER[currency] * months;
  const low = toUsdMonth(a.value, unitA);
  const high = toUsdMonth(b.value, b.unit || unitA);
  return { kind: "salary", minUsdMonth: Math.min(low, high), maxUsdMonth: Math.max(low, high) };
}

export function parsePay(raw: string | null | undefined): Pay {
  const text = (raw ?? "").toLowerCase().replace(/[–—]/g, "-").trim();
  if (!text) return { kind: "unknown" };
  if (/\b(unpaid|volunteer|no (pay|salary))\b/.test(text)) return { kind: "unpaid" };
  const amounts = amountsIn(text);
  if (!amounts.length) return /\bequity\b/.test(text) && !/\bsalary\b/.test(text) ? { kind: "equity" } : { kind: "unknown" };
  const currency = currencyOf(text);
  const months = currency ? perMonth(text, currency) : null;
  if (!currency || months === null) return { kind: "unknown" };
  return salaryRange(amounts, currency, months);
}

/** The user's minimum in US dollars per month, or 0 when no minimum is set. */
export function minPayUsdMonth(min: MinPay | null | undefined): number {
  if (!min || !(min.amount > 0)) return 0;
  return (min.amount * (USD_PER[min.currency] ?? 1)) / (min.period === "year" ? 12 : 1);
}

export function describeMinPay(min: MinPay | null | undefined): string {
  if (!min || !(min.amount > 0)) return "";
  return `${min.currency} ${min.amount.toLocaleString("en-US")} per ${min.period}`;
}
