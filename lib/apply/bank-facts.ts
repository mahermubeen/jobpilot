import type { Profile } from "@/lib/cv/types";
import type { ApplyFacts } from "@/lib/settings";
import type { FormField } from "./answers";
import { escapeRegExp } from "@/lib/util";
import { NO, optionLike, parseCvDate, type Shaped, val, YES, yearsBetween } from "./bank-shapes";

/** Facts the question bank reads from a question and the CV: countries named, and years with a technology. */

// ---------- countries ----------

const COUNTRIES: [string, RegExp][] = [
  ["United States", /\b(u\.s\.a?\.?|usa|united states|america)\b/i],
  ["United Kingdom", /\b(u\.k\.|uk|united kingdom|britain|great britain|england)\b/i],
  ["European Union", /\b(eu|e\.u\.|european union|eea|europe)\b/i],
  ["Canada", /\bcanad/i],
  ["Australia", /\baustralia/i],
  ["New Zealand", /\bnew zealand\b/i],
  ["Germany", /\bgerman/i],
  ["Netherlands", /\b(netherlands|holland|dutch)\b/i],
  ["Ireland", /\bireland\b/i],
  ["France", /\bfrance\b/i],
  ["Spain", /\bspain\b/i],
  ["Sweden", /\bsweden\b/i],
  ["Switzerland", /\bswitzerland\b/i],
  ["Poland", /\bpoland\b/i],
  ["United Arab Emirates", /\b(uae|u\.a\.e\.|united arab emirates|dubai|abu dhabi)\b/i],
  ["Saudi Arabia", /\b(saudi|ksa|riyadh|jeddah)\b/i],
  ["Qatar", /\b(qatar|doha)\b/i],
  ["Singapore", /\bsingapore\b/i],
  ["India", /\bindia\b/i],
  ["Pakistan", /\b(pakistan|islamabad|lahore|karachi|rawalpindi)\b/i],
];

/** Countries a text names. "US" only counts in capitals, so "about us" is not America. */
export function countriesIn(text: string): string[] {
  const out = COUNTRIES.filter(([, re]) => re.test(text)).map(([name]) => name);
  if (/\bUS\b/.test(text) && !out.includes("United States")) out.push("United States");
  return out.filter((c) => !(c === "United States" && /\b(about|contact|join|with|for) us\b/i.test(text) && !/\bUS\b|u\.s\.|usa|united states|america/i.test(text)));
}

const EU_MEMBERS = ["Germany", "Netherlands", "Ireland", "France", "Spain", "Sweden", "Poland"];

export function authorisedIn(country: string, facts: ApplyFacts): boolean {
  const mine = facts.authorizedCountries.flatMap((c) => countriesIn(c).concat(c.trim()));
  if (mine.some((c) => c.toLowerCase() === country.toLowerCase())) return true;
  return EU_MEMBERS.includes(country) && mine.includes("European Union");
}

/** The countries a work-rights question is about: named in it, else where the job is. */
export function questionCountries(label: string, jobLocation: string | null | undefined): string[] {
  const named = countriesIn(label);
  return named.length ? named : countriesIn(jobLocation ?? "");
}

// ---------- work rights ----------

const isYesNo = (o: string) => YES.concat(NO).some((re) => re.test(o));

/** Options that name a status ("Citizen", "Permanent resident", "Require sponsorship"), not yes/no. */
export const isStatusList = (f: FormField) => !!f.options?.length && !f.options.every(isYesNo);

export function statusAnswer(options: string[], authorised: boolean | null): Shaped | null {
  if (authorised === null) return null;
  return authorised
    ? val(optionLike(options, [/citizen/i, /authori[sz]ed/i, /no sponsorship/i, /^yes/i]))
    : val(optionLike(options, [/(require|need)\w* .*sponsor/i, /sponsor/i, /not authori[sz]ed/i, /^no\b/i]));
}

/** A typed answer: yes/no to a yes/no question, else where you may work. */
export function authorisationText(label: string, authorised: boolean | null, countries: string[]): Shaped | null {
  if (authorised !== null && /\?$|^(are|do|can|will|is)\b/i.test(label.trim())) return { value: authorised ? "Yes" : "No" };
  const list = countries.join(", ");
  return list ? { value: `Authorised to work in ${list}; would need visa sponsorship elsewhere.` } : null;
}

// ---------- tech experience ----------

const GENERIC_EXPERIENCE =
  /^(professional|work|working|relevant|industry|total|overall|software|software (development|engineering)|engineering|development|programming|it|tech|technology|full[- ]?time|related|similar|commercial|hands-on|practical|paid|post[- ]graduate|this|the|a|an)(\s+(experience|work|field|role|industry|engineering|development))*$/i;

/** The technology a years-of-experience question asks about, or "" for total experience; null when not such a question. */
export function experienceTopic(label: string): string | null {
  const l = label.replace(/\s+/g, " ").trim();
  if (!/\bexperience\b|\b(worked|working|using|coding|programming)\b/i.test(l) || !/\byears?\b|how (long|much)/i.test(l)) return null;
  const patterns = [
    /years? of ([\w.+#/ -]{1,40}?) (?:experience|development|programming)/i,
    /(?:experience|worked|working|proficien\w*|familiar\w*)\s+(?:with|in|using|on)\s+([^?.,;:()]{1,40})/i,
    /years? (?:have you )?(?:been )?(?:using|working with|working in|with|in)\s+([^?.,;:()]{1,40})/i,
    /(?:experience|years?)\b[^?]*?\b(?:with|in|using|on)\s+([^?.,;:()]{1,40})/i,
  ];
  for (const re of patterns) {
    const m = l.match(re);
    if (!m) continue;
    const topic = m[1]
      .replace(/\b(do you have|have you|you have|professionally|commercially|in total|total|overall)\b/gi, "")
      .replace(/\s+(development|programming|experience|years?)$/i, "")
      .trim();
    if (!topic || GENERIC_EXPERIENCE.test(topic)) return "";
    return topic;
  }
  return "";
}

/** Years using a technology, from the CV roles that mention it; null when no role does. */
export function techYears(topic: string, profile: Profile, now = new Date()): number | null {
  const words = topic.toLowerCase().split(/\s*(?:\/|,| or | and )\s*/).map((w) => w.trim()).filter(Boolean);
  const mentions = (text: string) =>
    words.some((w) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(w)}([^a-z0-9]|$)`, "i").test(text));
  let earliest: Date | null = null;
  for (const role of profile.experience) {
    if (!mentions([role.title, ...role.bullets].join(" "))) continue;
    const start = parseCvDate(role.start, now);
    if (start && (!earliest || start < earliest)) earliest = start;
  }
  if (!earliest) return null;
  return Math.max(1, Math.round(yearsBetween(earliest, now)));
}

// ---------- time zones ----------

type Offset = { sign: "+" | "-"; hours: number; minutes: number };

const OFFSET_TEXT = /(?:utc|gmt)\s*([+\-−])\s*(\d{1,2})(?::?(\d{2}))?/i;

const toOffset = (sign: string | undefined, hours = "0", minutes = "0"): Offset => ({
  sign: sign === "-" || sign === "−" ? "-" : "+",
  hours: Number(hours),
  minutes: Number(minutes),
});

/** An IANA zone's offset right now, as this computer's clock knows it ("America/New_York" → -5 in winter). */
function ianaOffset(zone: string, now: Date): Offset | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(now);
    const m = parts.find((p) => p.type === "timeZoneName")?.value.match(/^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/);
    return m ? toOffset(m[1], m[2], m[3]) : null;
  } catch {
    return null; // Not a zone this computer knows.
  }
}

/** The UTC offset a saved time zone names ("PKT (UTC+5)", "GMT+05:30"), or an IANA zone's offset right now. */
function zoneOffset(timezone: string, now: Date): Offset | null {
  const named = timezone.match(OFFSET_TEXT);
  if (named) return toOffset(named[1], named[2], named[3]);
  return timezone.includes("/") ? ianaOffset(timezone.trim(), now) : null;
}

/** "+05:00", "+5", "GMT+5" for +5, but not "+05:30" or "+50". */
function offsetPattern({ sign, hours, minutes }: Offset): RegExp {
  const mins = minutes ? `:?${String(minutes).padStart(2, "0")}` : "(?::?00)?";
  return new RegExp(`${sign === "-" ? "[-−]" : "\\+"}\\s*0?${hours}${mins}(?![:.]?\\d)`, "i");
}

/** The words a list might use for the zone: an IANA zone's city ("New York"), or the abbreviation ("PKT"). */
function zoneWords(timezone: string): string[] {
  const t = timezone.trim();
  const word = t.includes("/") ? t.split("/").at(-1)!.replace(/_/g, " ") : t.split(/[ (]/)[0];
  return word ? [word] : [];
}

/**
 * Patterns for picking your time zone from a list, from the time zone you saved:
 * its UTC offset first, then its name. Empty when no time zone is saved.
 */
export function timeZonePatterns(timezone: string, now = new Date()): RegExp[] {
  if (!timezone.trim()) return [];
  const offset = zoneOffset(timezone, now);
  return [...(offset ? [offsetPattern(offset)] : []), ...zoneWords(timezone).map((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`, "i"))];
}
