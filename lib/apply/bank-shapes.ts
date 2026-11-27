import { pickOption, type FormField } from "./answers";

/**
 * Shaping an answer for the field it goes in: an option, a tick, a number
 * range or plain text. Used by the question bank's rules.
 */

/** An answer before it is tagged with the rule that gave it. */
export type Shaped = {
  value: unknown;
  /** Leave the field empty on purpose (optional referrer name, marketing opt-in): no AI. */
  skip?: boolean;
  /** Overrides the 60-word limit for open answers (a cover letter goes in whole). */
  maxWords?: number;
  /** Salary for a job outside your home market with no stated range: needs the market rate. */
  needsMarket?: true;
};

export const val = (value: unknown) => (value === null || value === undefined || value === "" ? null : { value });
export const skip = () => ({ value: null, skip: true });

export const YES = [/^yes\b/i, /^(i )?(agree|accept|consent|acknowledge|confirm|certify|understand)\b/i, /^true$/i, /^y$/i];
export const NO = [/^no\b/i, /^(i )?(do not|don't|am not|have not|haven't|will not|won't|disagree)\b/i, /^false$/i, /^n$/i];
export const DECLINE = [/decline/i, /prefer not/i, /(do not|don't) (wish|want)/i, /not (to )?(say|disclose|answer|specify|identify)/i, /rather not/i];

/** The first option matching any pattern, in pattern order. */
export function optionLike(options: string[], patterns: RegExp[]): string | null {
  for (const re of patterns) {
    // eslint-disable-next-line no-restricted-syntax -- every caller passes a short fixed list (at most 6 regexes) whose order is the priority, so this is O(options), not O(n²)
    const hit = options.find((o) => re.test(o.trim()));
    if (hit) return hit;
  }
  return null;
}

/** A yes/no answer shaped for the field: an option, a tick, or the word. */
export function yesNo(field: FormField, yes: boolean): Shaped | null {
  if (field.options?.length) {
    const hit = optionLike(field.options, yes ? YES : NO);
    return hit ? { value: field.type === "checkbox" ? [hit] : hit } : null;
  }
  if (field.type === "checkbox") return yes ? { value: "yes" } : skip();
  return { value: yes ? "Yes" : "No" };
}

/** Option patterns for a fact: decline wording, or the caller's own patterns plus yes/no wording. */
function factPatterns(fact: string, extra: RegExp[]): RegExp[] {
  if (DECLINE.some((re) => re.test(fact))) return DECLINE;
  if (/^no$/i.test(fact)) return [...extra, ...NO];
  if (/^yes$/i.test(fact)) return [...extra, ...YES];
  return extra;
}

/** A fact such as "Male", "No" or "Prefer not to say" shaped for the field. */
export function factAnswer(field: FormField, fact: string, extra: RegExp[] = []): Shaped | null {
  const f = fact.trim();
  if (!f) return null;
  if (!field.options?.length) return field.type === "checkbox" ? null : { value: f };
  const hit = optionLike(field.options, factPatterns(f, extra)) ?? pickOption(field.options, f);
  return hit ? { value: hit } : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Jan 2025", "Sept 2025", "2022", "Present" → a date (present → now). */
export function parseCvDate(text: string, now = new Date()): Date | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/present|current|now|today/.test(t)) return now;
  const year = t.match(/\b(19|20)\d{2}\b/)?.[0];
  if (!year) return null;
  const month = MONTHS.findIndex((m) => t.includes(m));
  return new Date(Number(year), month >= 0 ? month : 0, 1);
}

export const yearsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / (365.25 * 24 * 3600 * 1000);

const OPEN_ABOVE = /\+|more|above|over|or greater|at least/i;
const OPEN_BELOW = /less|under|below|fewer|</i;

/** The number range an option names ("0-1", "5+", "Less than 1"), or null when it names no number. */
function optionRange(o: string): [number, number] | null {
  const nums = [...o.matchAll(/\d+(\.\d+)?/g)].map((m) => Number(m[0]));
  if (!nums.length) return null;
  if (nums.length === 1 && OPEN_BELOW.test(o)) return [0, nums[0] - 0.001];
  if (nums.length === 1 && OPEN_ABOVE.test(o)) return [nums[0], Infinity];
  return [nums[0], nums[1] ?? nums[0]];
}

/** Picks the option whose number range holds n ("0-1", "3 - 5 years", "5+", "Less than 1"), else the nearest. */
export function pickNumberOption(options: string[], n: number): string | null {
  let nearest: { o: string; d: number } | null = null;
  for (const o of options) {
    const range = optionRange(o);
    if (!range) continue;
    const [lo, hi] = range;
    if (n >= lo && n <= hi) return o;
    const d = Math.min(Math.abs(n - lo), Math.abs(n - hi));
    if (!nearest || d < nearest.d) nearest = { o, d };
  }
  return nearest?.o ?? null;
}

/** A number as the field wants it: an option range, digits, or text. */
export function numberAnswer(field: FormField, n: number, unit = ""): Shaped | null {
  if (field.options?.length) {
    const hit = pickNumberOption(field.options, n);
    return hit ? { value: hit } : null;
  }
  if (field.type === "number" || !unit) return { value: String(n) };
  return { value: `${n} ${unit}` };
}

/** Days in a notice-period option ("Immediately", "2 weeks", "1 month"); null when it names no time. */
function optionDays(o: string): number | null {
  const t = o.toLowerCase();
  if (/immediate|right away|asap|now/.test(t)) return 0;
  const n = Number(t.match(/\d+/)?.[0]);
  if (!Number.isFinite(n)) return null;
  if (/month/.test(t)) return n * 30;
  if (/week/.test(t)) return n * 7;
  if (/day/.test(t)) return n;
  return null;
}

export function durationAnswer(field: FormField, days: number, text: string): Shaped | null {
  if (field.options?.length) {
    let best: { o: string; d: number } | null = null;
    for (const o of field.options) {
      const od = optionDays(o);
      if (od === null) continue;
      const d = Math.abs(od - days);
      if (!best || d < best.d) best = { o, d };
    }
    return best ? { value: best.o } : null;
  }
  return field.type === "number" ? { value: String(days) } : { value: text };
}
