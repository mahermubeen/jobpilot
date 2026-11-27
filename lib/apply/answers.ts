import type { Profile } from "@/lib/cv/types";
import { linkKey, pageKey } from "@/lib/pipeline/dedupe";
import { escapeRegExp } from "@/lib/util";

/** One input found on an application form by the browser extension. */
export type FormField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "email" | "tel" | "url" | "date" | "select" | "radio" | "checkbox" | "file";
  /** Choices of a dropdown, radio group or checkbox group. */
  options?: string[];
  required?: boolean;
  maxLength?: number;
};

export type FieldValue = string | string[] | null;
export type AnswerSource = "profile" | "bank" | "saved" | "learned" | "ai" | "none";
/** `skip`: the field is optional and best left empty (a referrer's name, say), so nothing is written and the AI is not asked. */
export type FieldAnswer = {
  id: string;
  value: FieldValue;
  source: AnswerSource;
  skip?: boolean;
  /** For answer-bank hits: which rule answered ("work-authorisation", "salary"). */
  rule?: string;
};
export type SavedAnswer = { question: string; answer: string };

const MAX_FIELDS = 60;
const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const TYPES = new Set<string>(["text", "textarea", "number", "email", "tel", "url", "date", "select", "radio", "checkbox", "file"]);

const MAX_OPTIONS = 300;

function parseOptions(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const options = v.map((o) => clean(o, 160)).filter(Boolean).slice(0, MAX_OPTIONS);
  return options.length ? options : undefined;
}

/** One field as the extension sent it, or null when it has no id or an unknown type. */
function parseField(raw: unknown): FormField | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = clean(r.id, 80);
  const type = clean(r.type, 20);
  if (!id || !TYPES.has(type)) return null;
  const options = parseOptions(r.options);
  const maxLength = Number(r.maxLength);
  return {
    id,
    label: clean(r.label, 400),
    type: type as FormField["type"],
    ...(options ? { options } : {}),
    ...(r.required ? { required: true } : {}),
    ...(maxLength > 0 ? { maxLength } : {}),
  };
}

/** Normalises what the extension sends; anything malformed is dropped, and so are repeated ids. */
export function parseFields(input: unknown): FormField[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .slice(0, MAX_FIELDS)
    .map(parseField)
    .filter((f): f is FormField => {
      if (!f || seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
}

const linkTo = (profile: Profile, re: RegExp) =>
  profile.links.find((l) => re.test(l.label) || re.test(l.url))?.url ?? "";

/** Field kinds that are never a plain contact detail. */
const NOT_CONTACT: FormField["type"][] = ["checkbox", "file", "textarea"];

type ContactRule = { matches: (field: FormField, label: string) => boolean; value: (profile: Profile, names: string[]) => string };

/** Contact fields in order of precedence: the first that matches answers. */
const CONTACT_RULES: ContactRule[] = [
  { matches: (f, l) => f.type === "email" || /\be-?mail\b/.test(l), value: (p) => p.email },
  { matches: (f, l) => f.type === "tel" || /\b(phone|mobile|contact number)\b/.test(l), value: (p) => p.phone },
  { matches: (_f, l) => /\blinkedin\b/.test(l), value: (p) => linkTo(p, /linkedin/i) },
  { matches: (_f, l) => /\bgithub\b/.test(l), value: (p) => linkTo(p, /github/i) },
  { matches: (_f, l) => /\b(portfolio|personal (web)?site|website)\b/.test(l), value: (p) => linkTo(p, /portfolio|website|site/i) },
  { matches: (_f, l) => /\bfirst name\b|\bgiven name\b/.test(l), value: (_p, names) => names[0] ?? "" },
  { matches: (_f, l) => /\b(last name|surname|family name)\b/.test(l), value: (_p, names) => (names.length > 1 ? names.slice(1).join(" ") : "") },
  {
    matches: (_f, l) => /^(full |legal |your )?name\b/.test(l) && !/company|employer|school|university|referr/.test(l),
    value: (p) => p.name,
  },
];

/** Contact fields have short labels; a long one is a real question for the AI step. */
const MAX_CONTACT_LABEL = 40;

/** Contact details answered straight from the profile, with no AI involved. */
export function profileAnswer(field: FormField, profile: Profile): string | null {
  if (field.options?.length || NOT_CONTACT.includes(field.type)) return null;
  const label = field.label.toLowerCase();
  if (label.length > MAX_CONTACT_LABEL) return null;
  const rule = CONTACT_RULES.find((r) => r.matches(field, label));
  const value = rule ? rule.value(profile, profile.name.trim().split(/\s+/)) : "";
  return value.trim() || null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The option a wanted answer means: an exact match first, then an option that
 * starts with it as a whole word ("Yes" → "Yes, I am authorised"), then the
 * reverse ("Bachelor's degree in CS" → "Bachelor's degree").
 */
export function pickOption(options: string[], wanted: unknown): string | null {
  const w = String(wanted ?? "").trim();
  if (!w) return null;
  const exact = options.find((o) => same(o, w));
  if (exact) return exact;
  const lw = w.toLowerCase();
  const starts = options.find((o) => new RegExp(`^${escapeRegExp(lw)}\\b`, "i").test(o.trim()));
  if (starts) return starts;
  return options.find((o) => o.trim().length > 1 && new RegExp(`^${escapeRegExp(o.trim().toLowerCase())}\\b`).test(lw)) ?? null;
}

/** Open answers stay short: at most this many words, cut at a full sentence. */
export const MAX_OPEN_WORDS = 60;

/** Cuts text to the last whole sentence that fits both limits, or null if not even one does. */
export function trimToSentences(text: string, maxWords: number, maxChars?: number): string | null {
  const fits = (t: string) => t.split(/\s+/).filter(Boolean).length <= maxWords && (!maxChars || t.length <= maxChars);
  if (fits(text)) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = "";
  for (const s of sentences) {
    const next = (out + s).trim();
    if (!fits(next)) break;
    out = next + " ";
  }
  return out.trim() || null;
}

const BLANK = /^(leave blank|n\/?a|unknown|not (stated|available|sure)|null|none)?$/i;

/** Choice fields: only real options, and a list of them for checkbox groups. */
function validateChoice(field: FormField, options: string[], value: unknown): FieldValue {
  const pick = (v: unknown) => pickOption(options, v);
  if (field.type !== "checkbox") return pick(Array.isArray(value) ? value[0] : value);
  const picked = (Array.isArray(value) ? value : [value]).map(pick).filter((o): o is string => !!o);
  return picked.length ? [...new Set(picked)] : null;
}

const matchOrNull = (re: RegExp) => (text: string) => (re.test(text) ? text : null);

/** Per-type checks for free-text answers; types not listed keep the text, cut to the field's limit. */
const TEXT_CHECKS: Partial<Record<FormField["type"], (text: string, field: FormField, maxWords: number) => FieldValue>> = {
  checkbox: (text) => (/^(yes|true)$/i.test(text) ? "yes" : null),
  number: (text) => {
    const n = text.replace(/,/g, "");
    return /^-?\d+(\.\d+)?$/.test(n) ? n : null;
  },
  date: matchOrNull(/^\d{4}-\d{2}-\d{2}$/),
  email: matchOrNull(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  url: matchOrNull(/^https?:\/\/\S+$/i),
  // A cut-off sentence reads worse than an empty box the user fills in.
  textarea: (text, field, maxWords) => trimToSentences(text, maxWords, field.maxLength),
};

const cutToLimit = (text: string, field: FormField) => (field.maxLength && text.length > field.maxLength ? text.slice(0, field.maxLength) : text);

/**
 * Makes an answer safe to put in a form: choices must be real options,
 * numbers must be numbers, and text respects the field's length limit.
 * Returns null when the field should be left for the user.
 */
export function validateAnswer(field: FormField, value: unknown, maxWords = MAX_OPEN_WORDS): FieldValue {
  if (field.type === "file") return null;
  if (field.options?.length) return validateChoice(field, field.options, value);
  if (Array.isArray(value) || value === null || value === undefined) return null;
  const text = String(value).trim();
  if (BLANK.test(text)) return null;
  const check = TEXT_CHECKS[field.type];
  return check ? check(text, field, maxWords) : cutToLimit(text, field);
}

type JobLink = { id: string; link: string | null; sourceId?: string | null };

type UrlParts = NonNullable<ReturnType<typeof urlParts>>;

/**
 * The same page with other query parameters, when the job is named by the path
 * itself (not by ?id=…, which would mix up jobs sharing one page).
 */
function samePageMatch<T extends JobLink>(url: string, jobs: T[]): T | null {
  const page = pageKey(url);
  if (page.split("/").length <= 2) return null;
  return jobs.find((j) => j.link && !linkKey(j.link).includes("?") && pageKey(j.link) === page) ?? null;
}

/** LinkedIn shows one posting under several URL shapes and country subdomains; the numeric id is stable. */
function linkedInMatch<T extends JobLink>(url: string, jobs: T[]): T | null {
  const tabId = linkedInId(url);
  if (!tabId) return null;
  return jobs.find((j) => j.link && /linkedin\.com/i.test(j.link) && linkedInId(j.link) === tabId) ?? null;
}

/** A company careers page embedding Greenhouse: ?gh_jid=123 is the job at …/jobs/123. */
function greenhouseMatch<T extends JobLink>(tab: UrlParts, jobs: T[]): T | null {
  const ghJid = tab.query.get("gh_jid");
  if (!ghJid) return null;
  return (
    jobs.find((j) => {
      const p = j.link ? urlParts(j.link) : null;
      return p && (p.query.get("gh_jid") === ghJid || p.path.at(-1) === ghJid);
    }) ?? null
  );
}

/** Length of the shared path when one path starts with the whole of the other, else 0. */
function sharedPrefix(a: string[], b: string[]): number {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((seg, i) => long[i] === seg) ? short.length : 0;
}

/**
 * The application form lives under the listing (…/<id>/apply, …/<id>/application), or the
 * saved link is the form and this is the listing. The shorter path needs two parts at least,
 * so a bare /careers never matches every job on a site. The longest shared path wins.
 */
function pathPrefixMatch<T extends JobLink>(tab: UrlParts, jobs: T[]): T | null {
  let best: { job: T; len: number } | null = null;
  for (const j of jobs) {
    const p = j.link ? urlParts(j.link) : null;
    const len = p && p.host === tab.host ? sharedPrefix(p.path, tab.path) : 0;
    if (len >= 2 && (!best || len > best.len)) best = { job: j, len };
  }
  return best?.job ?? null;
}

function otherSiteMatch<T extends JobLink>(url: string, jobs: T[]): T | null {
  const tab = urlParts(url);
  return tab ? (greenhouseMatch(tab, jobs) ?? pathPrefixMatch(tab, jobs)) : null;
}

/** Finds the saved job a browser tab belongs to, by its listing link. */
export function matchJob<T extends JobLink>(url: string, jobs: T[]): T | null {
  const key = linkKey(url);
  if (!key) return null;
  const exact = jobs.find((j) => j.link && linkKey(j.link) === key);
  if (exact) return exact;
  const samePage = samePageMatch(url, jobs);
  if (samePage) return samePage;
  return /linkedin\.com/i.test(url) ? linkedInMatch(url, jobs) : otherSiteMatch(url, jobs);
}

function urlParts(url: string) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname.toLowerCase().replace(/^www\./, ""),
      path: u.pathname.toLowerCase().split("/").filter(Boolean),
      query: u.searchParams,
    };
  } catch {
    return null;
  }
}

function linkedInId(url: string): string | null {
  const fromQuery = url.match(/[?&]currentJobId=(\d{6,})/)?.[1];
  if (fromQuery) return fromQuery;
  const path = url.split(/[?#]/)[0];
  return path.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})\/?$/)?.[1] ?? null;
}
