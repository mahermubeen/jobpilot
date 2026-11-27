import { getState, setState } from "@/lib/settings";
import { oneAtATime } from "@/lib/util";
import { validateAnswer, type FieldValue, type FormField } from "./answers";

/**
 * Answers remembered from earlier forms. Every AI answer that passes the
 * checks is saved here, so the same question never goes to the AI twice.
 * Answers written for one job ("Why do you want to work here?") are kept for
 * that job only.
 */
export type LearnedAnswer = {
  id: string;
  question: string;
  /** Normalised question words, for matching. */
  key: string;
  answer: string | string[];
  type: FormField["type"];
  /** "all", or the job id the answer was written for. */
  scope: string;
  uses: number;
  at: number;
  /** "AI", or "you" for answers you gave or corrected yourself; yours win over the answer bank. */
  by?: string;
};

const KEY = "learnedAnswers";
const MAX = 5000;
const JOB_SCOPED_DAYS = 60;

const FILLER = new Set(
  "a an the of in on at to for with and or your you do does did are is am be been being have has had what which please enter provide select choose tell us describe briefly kindly currently how would will can could if any this that our we i me my it its here there below above field question answer optional required".split(" "),
);

/** The words that matter in a question: lowercase, no punctuation or filler, British/American spellings joined, plurals dropped. */
export function questionKey(label: string): string {
  // Lever's ✱ marks a required field; anything after it is a dropdown's helper text.
  const star = label.indexOf("✱");
  const question = star > 0 ? label.slice(0, star) : label;
  return question
    .toLowerCase()
    .replace(/\((required|optional)\)|\*/g, " ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/\.+$/, ""))
    .filter((w) => w && !FILLER.has(w))
    .map((w) => w.replace(/is(e|ed|es|ing|ation)$/, "iz$1").replace(/our$/, "or"))
    .map((w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w))
    .join(" ");
}

/** Words whose presence on one side only does not change what is asked ("notice period" vs "notice period in days"). */
const HARMLESS = new Set(
  "day week month year number amount total approximate approximately much many long time period kindly overall exact e.g eg etc mention format digit numeric only number value".split(" "),
);

/**
 * How alike two question keys are, 0–1. Near matches only count when every
 * word that differs is harmless; otherwise they must be almost identical, so
 * "React" never answers for "React Native" and "current" never for "expected".
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  const score = shared / (A.size + B.size - shared);
  const differing = [...A].filter((w) => !B.has(w)).concat([...B].filter((w) => !A.has(w)));
  return differing.every((w) => HARMLESS.has(w)) ? score : score >= 0.85 ? score : 0;
}

export const MATCH_THRESHOLD = 0.6;

type Remembered = { question: string; answer: string | string[]; scope?: string };
type Candidate<T> = { value: FieldValue; entry: T; score: number };

const inScope = (entry: Remembered, jobId: string) => !entry.scope || entry.scope === "all" || entry.scope === jobId;

/** Remembered answers similar enough to the field's question, in scope, and valid for the field, in saved order. */
function candidates<T extends Remembered>(field: FormField, entries: T[], jobId: string): Candidate<T>[] {
  const key = questionKey(field.label);
  if (!key) return [];
  return entries.flatMap((entry) => {
    const answer = Array.isArray(entry.answer) ? entry.answer : String(entry.answer ?? "").trim();
    if (!inScope(entry, jobId) || !answer.length) return [];
    // Recomputed, so answers saved before a matching fix still match.
    const score = similarity(key, questionKey(entry.question));
    if (score < MATCH_THRESHOLD) return [];
    const value = validateAnswer(field, answer);
    return value === null ? [] : [{ value, entry, score }];
  });
}

/**
 * The best remembered answer for a field: same or similar question, usable
 * for this field (a valid option, the right kind of value), in scope for this
 * job. Returns the cleaned value and the entry it came from. Ties go to the one saved first.
 */
export function findAnswer<T extends Remembered>(field: FormField, entries: T[], jobId: string): { value: FieldValue; entry: T } | null {
  const best = candidates(field, entries, jobId).reduce<Candidate<T> | null>((b, c) => (!b || c.score > b.score ? c : b), null);
  return best ? { value: best.value, entry: best.entry } : null;
}

/** The best few remembered answers for a field, best first, each value once. */
export function findAnswers<T extends Remembered>(field: FormField, entries: T[], jobId: string, limit = 3): { value: FieldValue; entry: T }[] {
  const hits = candidates(field, entries, jobId).sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: { value: FieldValue; entry: T }[] = [];
  for (const h of hits) {
    const k = JSON.stringify(h.value).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ value: h.value, entry: h.entry });
    if (out.length >= limit) break;
  }
  return out;
}

/** Whether an open answer was written for this job and would read wrong for another company. */
export function isJobSpecific(field: FormField, company: string): boolean {
  const l = field.label.toLowerCase();
  if (company && l.includes(company.toLowerCase())) return true;
  if (field.type !== "textarea") return false;
  return /\b(this|our|the) (role|position|job|company|team|opportunity|product|mission)\b|why (do you want|are you|would you|us|join|apply|here)|interest(s|ed)? you|excite[sd]? you|attract(s|ed)? you|cover letter|fit for/.test(l);
}

/** Runs read-modify-write steps one at a time, so two forms filling at once do not lose answers. */
const serial = oneAtATime();

export async function getLearned(): Promise<LearnedAnswer[]> {
  return (await getState<LearnedAnswer[]>(KEY)) ?? [];
}

function prune(list: LearnedAnswer[], now: number): LearnedAnswer[] {
  const cutoff = now - JOB_SCOPED_DAYS * 86400_000;
  const kept = list.filter((e) => e.scope === "all" || e.at >= cutoff);
  return kept.length > MAX ? kept.sort((a, b) => b.at - a.at).slice(0, MAX) : kept;
}

/** Answers with the same slot replace each other. */
const slot = (e: Pick<LearnedAnswer, "key" | "scope" | "type">) => `${e.key}\u0000${e.scope}\u0000${e.type}`;

/** Saves new answers, replacing an older answer to the same question in the same scope. */
export function learn(items: Omit<LearnedAnswer, "id" | "key" | "uses" | "at">[], now = Date.now()) {
  if (!items.length) return Promise.resolve();
  return serial(async () => {
    const list = await getLearned();
    // Position of each saved answer by question, scope and type; the first one wins, as findIndex did.
    const at = new Map<string, number>();
    list.forEach((e, i) => { if (!at.has(slot(e))) at.set(slot(e), i); });
    for (const item of items) {
      const key = questionKey(item.question);
      if (!key) continue;
      const i = at.get(slot({ ...item, key }));
      const entry: LearnedAnswer = { ...item, key, id: i === undefined ? crypto.randomUUID() : list[i].id, uses: 0, at: now };
      if (i === undefined) at.set(slot(entry), list.push(entry) - 1);
      else list[i] = entry;
    }
    await setState(KEY, prune(list, now));
  });
}

/** Counts reuse, so Settings can show which remembered answers save the most calls. */
export function markUsed(ids: string[]) {
  if (!ids.length) return Promise.resolve();
  return serial(async () => {
    const list = await getLearned();
    const set = new Set(ids);
    for (const e of list) if (set.has(e.id)) e.uses++;
    await setState(KEY, list);
  });
}

export function updateLearned(id: string, answer: string | string[] | null) {
  return serial(async () => {
    const list = await getLearned();
    const next = answer === null ? list.filter((e) => e.id !== id) : list.map((e) => (e.id === id ? { ...e, answer, by: "you", at: Date.now() } : e));
    await setState(KEY, next);
  });
}
