import type { Profile } from "@/lib/cv/types";
import type { ApplyFacts } from "@/lib/settings";
import { pickOption, type FormField } from "./answers";
import { resolveSalary, salaryQuestion, type SalaryJob } from "./salary";

/**
 * The question bank: the questions application forms ask again and again,
 * answered from your profile and facts with no AI. A rule returns null when
 * it cannot answer; the field then goes on to saved answers, learned answers
 * and, last, the AI.
 */

export type BankJob = SalaryJob & { id?: string; source?: string | null; cover?: string | null };
export type BankContext = { profile: Profile; facts: ApplyFacts; job: BankJob; now?: Date };

export type BankAnswer = {
  rule: string;
  value: unknown;
  /** Leave the field empty on purpose (optional referrer name, marketing opt-in): no AI. */
  skip?: boolean;
  /** Overrides the 60-word limit for open answers (a cover letter goes in whole). */
  maxWords?: number;
  /** Salary for a job outside your home market with no stated range: needs the market rate. */
  needsMarket?: true;
};

type Rule = { id: string; match: (label: string, field: FormField) => boolean; answer: (field: FormField, ctx: BankContext, label: string) => Omit<BankAnswer, "rule"> | null };

// ---------- helpers ----------

const has = (re: RegExp) => (label: string) => re.test(label);
const val = (value: unknown) => (value === null || value === undefined || value === "" ? null : { value });
const skip = () => ({ value: null, skip: true });

const YES = [/^yes\b/i, /^(i )?(agree|accept|consent|acknowledge|confirm|certify|understand)\b/i, /^true$/i, /^y$/i];
const NO = [/^no\b/i, /^(i )?(do not|don't|am not|have not|haven't|will not|won't|disagree)\b/i, /^false$/i, /^n$/i];
const DECLINE = [/decline/i, /prefer not/i, /(do not|don't) (wish|want)/i, /not (to )?(say|disclose|answer|specify|identify)/i, /rather not/i];

/** The first option matching any pattern, in pattern order. */
function optionLike(options: string[], patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const hit = options.find((o) => re.test(o.trim()));
    if (hit) return hit;
  }
  return null;
}

/** A yes/no answer shaped for the field: an option, a tick, or the word. */
function yesNo(field: FormField, yes: boolean): Omit<BankAnswer, "rule"> | null {
  if (field.options?.length) {
    const hit = optionLike(field.options, yes ? YES : NO);
    return hit ? { value: field.type === "checkbox" ? [hit] : hit } : null;
  }
  if (field.type === "checkbox") return yes ? { value: "yes" } : skip();
  return { value: yes ? "Yes" : "No" };
}

/** A fact such as "Male", "No" or "Prefer not to say" shaped for the field. */
function factAnswer(field: FormField, fact: string, extra: RegExp[] = []): Omit<BankAnswer, "rule"> | null {
  const f = fact.trim();
  if (!f) return null;
  if (!field.options?.length) return field.type === "checkbox" ? null : { value: f };
  const patterns = DECLINE.some((re) => re.test(f)) ? DECLINE : /^no$/i.test(f) ? [...extra, ...NO] : /^yes$/i.test(f) ? [...extra, ...YES] : extra;
  const hit = optionLike(field.options, patterns) ?? pickOption(field.options, f);
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

const yearsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / (365.25 * 24 * 3600 * 1000);

/** Picks the option whose number range holds n ("0-1", "3 - 5 years", "5+", "Less than 1"). */
export function pickNumberOption(options: string[], n: number): string | null {
  let nearest: { o: string; d: number } | null = null;
  for (const o of options) {
    const nums = [...o.matchAll(/\d+(\.\d+)?/g)].map((m) => Number(m[0]));
    if (!nums.length) continue;
    let lo = nums[0];
    let hi = nums[1] ?? nums[0];
    if (/\+|more|above|over|or greater|at least/i.test(o) && nums.length === 1) hi = Infinity;
    if (/less|under|below|fewer|</i.test(o) && nums.length === 1) {
      hi = nums[0] - 0.001;
      lo = 0;
    }
    if (n >= lo && n <= hi) return o;
    const d = Math.min(Math.abs(n - lo), Math.abs(n - hi));
    if (!nearest || d < nearest.d) nearest = { o, d };
  }
  return nearest?.o ?? null;
}

/** A number as the field wants it: an option range, digits, or text. */
function numberAnswer(field: FormField, n: number, unit = ""): Omit<BankAnswer, "rule"> | null {
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

function durationAnswer(field: FormField, days: number, text: string): Omit<BankAnswer, "rule"> | null {
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

function authorisedIn(country: string, facts: ApplyFacts): boolean {
  const mine = facts.authorizedCountries.flatMap((c) => countriesIn(c).concat(c.trim()));
  if (mine.some((c) => c.toLowerCase() === country.toLowerCase())) return true;
  return EU_MEMBERS.includes(country) && mine.includes("European Union");
}

/** The countries a work-rights question is about: named in it, else where the job is. */
function questionCountries(label: string, job: BankJob): string[] {
  const named = countriesIn(label);
  if (named.length) return named;
  if (/this (country|location)|where (this|the) (job|role|position)|job location|country (in which|where)/i.test(label)) {
    return countriesIn(job.location ?? "");
  }
  return countriesIn(job.location ?? "");
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
    words.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text));
  let earliest: Date | null = null;
  for (const role of profile.experience) {
    if (!mentions([role.title, ...role.bullets].join(" "))) continue;
    const start = parseCvDate(role.start, now);
    if (start && (!earliest || start < earliest)) earliest = start;
  }
  if (!earliest) return null;
  return Math.max(1, Math.round(yearsBetween(earliest, now)));
}

// ---------- the rules ----------

const MARKETING = /newsletter|marketing|promotion|\bsms\b|text messages?|whatsapp|job alerts?|\bnews\b|updates? (about|on|from)|future (job|opportunit|role|position|openings)|talent (community|pool|network)|stay in touch|subscribe|other (roles|positions|opportunities)/i;
const CONSENT = /privacy|terms|conditions|consent|\bagree\b|acknowledge|certify|i confirm|accurate|true and (complete|correct)|gdpr|data (processing|protection|retention|privacy)|i (have )?read|declar|background check|authori[sz]e .*(contact|process|verif|share)/i;

function currentRole(profile: Profile) {
  return profile.experience.find((e) => /present|current|now/i.test(e.end)) ?? null;
}

const RULES: Rule[] = [
  {
    id: "marketing-optin",
    match: (l, f) => (f.type === "checkbox" || !!f.options?.length) && MARKETING.test(l) && !/privacy|terms/i.test(l),
    answer: (f) => (f.type === "checkbox" && !f.options?.length ? skip() : yesNo(f, false)),
  },
  {
    id: "salary",
    match: (l) => salaryQuestion(l) !== null,
    answer: (f, ctx) => {
      const r = resolveSalary(f, ctx.facts, ctx.job);
      if (!r) return null;
      if ("needsMarket" in r) return { value: null, needsMarket: true };
      return { value: r.value };
    },
  },
  {
    id: "sponsorship",
    match: (l) => /sponsor|\bh-?1b\b/i.test(l) && !/without (any |visa |employer |the need for )*sponsor/i.test(l),
    answer: (f, ctx, l) => {
      const countries = questionCountries(l, ctx.job);
      if (!countries.length) return null;
      const authorised = countries.every((c) => authorisedIn(c, ctx.facts));
      return yesNo(f, !authorised);
    },
  },
  {
    id: "work-authorisation",
    match: has(/authori[sz](ed|ation)|eligib\w* to work|legally (able|allowed|permitted|entitled)? ?(to )?work|right to work|work (permit|visa)|permission to work|visa status|immigration status|citizen/i),
    answer: (f, ctx, l) => {
      const countries = questionCountries(l, ctx.job);
      const authorised = countries.length ? countries.every((c) => authorisedIn(c, ctx.facts)) : null;
      if (/remote(ly)? from|from your (current )?(country|location)/i.test(l)) return yesNo(f, true);
      if (f.options?.length && !f.options.every((o) => YES.concat(NO).some((re) => re.test(o)))) {
        // A status list: "Citizen", "Permanent resident", "Require sponsorship"…
        if (authorised === null) return null;
        return authorised
          ? val(optionLike(f.options, [/citizen/i, /authori[sz]ed/i, /no sponsorship/i, /^yes/i]))
          : val(optionLike(f.options, [/(require|need)\w* .*sponsor/i, /sponsor/i, /not authori[sz]ed/i, /^no\b/i]));
      }
      if (authorised !== null && f.type !== "text" && f.type !== "textarea") return yesNo(f, authorised);
      if (f.type === "text" || f.type === "textarea") {
        if (authorised !== null && /\?$|^(are|do|can|will|is)\b/i.test(l.trim())) return { value: authorised ? "Yes" : "No" };
        const list = ctx.facts.authorizedCountries.join(", ");
        return list ? { value: `Authorised to work in ${list}; would need visa sponsorship elsewhere.` } : null;
      }
      return authorised === null ? null : yesNo(f, authorised);
    },
  },
  {
    id: "age",
    match: has(/\b(18|eighteen|21)\b.*(years|older|age)|legal (working )?age|of legal age|at least 18/i),
    answer: (f) => yesNo(f, true),
  },
  {
    id: "relocate",
    match: has(/relocat/i),
    answer: (f, ctx) => yesNo(f, ctx.facts.relocate),
  },
  {
    id: "remote",
    match: has(/(comfortable|willing|able|open|happy|okay|ok)\b.*\bremote(ly)?\b|remote (work|position|role|setup|environment)|work(ing)? remotely/i),
    answer: (f, ctx) => yesNo(f, ctx.facts.workModes.includes("Remote")),
  },
  {
    id: "onsite",
    match: has(/on-?site|in[- ]office|in the office|\bhybrid\b|commut|come (in)?to (the|our) office|work from (our|the) office|report to (the|our) office/i),
    answer: (f, ctx, l) => {
      const elsewhere = countriesIn(`${l} ${ctx.job.location ?? ""}`).some((c) => !authorisedIn(c, ctx.facts));
      const otherCity = ctx.facts.city && ctx.job.location && !ctx.job.location.toLowerCase().includes(ctx.facts.city.toLowerCase());
      if ((elsewhere || otherCity) && !ctx.facts.relocate) return yesNo(f, false);
      const mode = /hybrid/i.test(l) ? "Hybrid" : "Onsite";
      return yesNo(f, ctx.facts.workModes.includes(mode));
    },
  },
  {
    id: "travel",
    match: has(/\btravel\b/i),
    answer: (f, ctx, l) => (/percent|%|how much|how often/i.test(l) && !f.options?.length ? null : yesNo(f, ctx.facts.travel)),
  },
  {
    id: "notice-period",
    match: has(/notice period|notice (do you|you need|required)|how much notice/i),
    answer: (f, ctx) => {
      const d = ctx.facts.noticeDays;
      return durationAnswer(f, d, d === 0 ? "Immediately" : d % 30 === 0 ? `${d / 30} month${d === 30 ? "" : "s"}` : d % 7 === 0 ? `${d / 7} week${d === 7 ? "" : "s"}` : `${d} days`);
    },
  },
  {
    id: "start-immediately",
    match: has(/(start|join) immediately|immediate (joiner|start|availability)/i),
    answer: (f, ctx) => yesNo(f, ctx.facts.noticeDays <= 7),
  },
  {
    id: "start-date",
    match: has(/(earliest|soonest|when (can|could|would) you|available to|able to) (start|join|begin)|start date|availability date|date (you are )?available|when are you available/i),
    answer: (f, ctx) => {
      const now = ctx.now ?? new Date();
      const d = ctx.facts.noticeDays;
      const date = new Date(now.getTime() + d * 86400_000);
      if (f.type === "date") return { value: date.toISOString().slice(0, 10) };
      if (f.options?.length) return durationAnswer(f, d, "");
      const readable = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      return { value: d <= 3 ? `Immediately (${readable})` : readable };
    },
  },
  {
    id: "currently-employed",
    match: has(/(are you )?currently (employed|working)|employment status/i),
    answer: (f, ctx) => (f.options?.length && !/^are|^do/i.test(f.label) ? val(optionLike(f.options, currentRole(ctx.profile) ? [/^employed/i, /full[- ]time/i, /^yes/i] : [/unemployed|not employed/i, /^no/i])) : yesNo(f, !!currentRole(ctx.profile))),
  },
  {
    id: "previous-employee",
    match: has(/(previously|ever|before) (been )?(employed|worked|work)|former (employee|intern|contractor)|(current|former) employee|worked (for|at|with) .{1,40} (before|previously)/i),
    answer: (f, ctx) => {
      const company = (ctx.job.company ?? "").toLowerCase();
      const worked = !!company && ctx.profile.experience.some((e) => e.company.toLowerCase().includes(company));
      return yesNo(f, worked);
    },
  },
  {
    id: "relatives",
    match: has(/relative|family member|related to (anyone|someone|an employee)/i),
    answer: (f) => yesNo(f, false),
  },
  {
    id: "non-compete",
    match: has(/non-?compete|restrictive covenant|non-?solicit/i),
    answer: (f) => yesNo(f, false),
  },
  {
    id: "background-check",
    match: (l, f) => /background (check|screening|verification)|drug (test|screen)|reference check/i.test(l) && f.type !== "textarea",
    answer: (f) => yesNo(f, true),
  },
  {
    id: "years-experience",
    match: (l) => experienceTopic(l) !== null,
    answer: (f, ctx, l) => {
      const topic = experienceTopic(l)!;
      const total = Number(ctx.facts.totalYears);
      if (!topic) return total > 0 ? numberAnswer(f, total, "years") : null;
      const years = techYears(topic, ctx.profile, ctx.now);
      if (years === null) return null;
      return numberAnswer(f, Math.min(years, total > 0 ? total : years), "years");
    },
  },
  {
    id: "current-company",
    match: has(/current (company|employer|organi[sz]ation)|(present|most recent) (employer|company)/i),
    answer: (_f, ctx) => val(currentRole(ctx.profile)?.company ?? ctx.profile.experience[0]?.company),
  },
  {
    id: "current-title",
    match: has(/current (job )?(title|position|role|designation)|^job title$|most recent (job )?(title|position|role)/i),
    answer: (_f, ctx) => val(currentRole(ctx.profile)?.title ?? ctx.profile.experience[0]?.title),
  },
  {
    id: "position-applied",
    match: has(/(position|role|job) (you are |you're )?applying (for|to)|desired (position|title|role|job)/i),
    answer: (_f, ctx) => val(ctx.job.role),
  },
  {
    id: "degree",
    match: has(/(highest|level of) (education|degree|qualification)|education level|^degree( type| obtained| earned)?$|^education$/i),
    answer: (f, ctx) => {
      const degree = ctx.profile.education[0]?.degree ?? "";
      if (!degree) return null;
      if (!f.options?.length) return { value: degree };
      const level = /ph\.?d|doctor/i.test(degree) ? [/ph\.?d|doctor/i] : /master|\bms\b|\bmsc\b|m\.?s\.?\b|mba|m\.?tech/i.test(degree) ? [/master/i] : [/bachelor/i, /undergrad/i, /\bbs\b|\bb\.?s\.?c?\b/i];
      return val(optionLike(f.options, level));
    },
  },
  {
    id: "field-of-study",
    match: has(/(field|area) of study|\bmajor\b|discipline|subject studied/i),
    answer: (_f, ctx) => val(ctx.profile.education[0]?.degree.split(/\bin\b/i)[1]?.trim()),
  },
  {
    id: "school",
    match: has(/(school|university|college|institution|institute)( name)?$|name of (your )?(school|university|college|institution)|which (university|college)/i),
    answer: (_f, ctx) => val(ctx.profile.education[0]?.school),
  },
  {
    id: "graduation",
    match: has(/graduat(ion|ed)( year| date)?|year of (graduation|completion)|when did you graduate/i),
    answer: (f, ctx) => {
      const end = parseCvDate(ctx.profile.education[0]?.end ?? "");
      if (!end) return null;
      if (f.type === "date") return { value: end.toISOString().slice(0, 10) };
      return { value: String(end.getFullYear()) };
    },
  },
  {
    id: "gpa",
    match: has(/\b(gpa|cgpa|grade point)\b/i),
    answer: () => skip(),
  },
  {
    id: "hear-about",
    match: has(/how did you (hear|find|learn|come across)|where did you (hear|find|see|learn)|source of (your )?application|referral source|how did you discover|(which|what) (location|site|website|platform|place|channel) did you (find|see|hear|discover)|where did you come across/i),
    answer: (f, ctx) => {
      const src = (ctx.job.source ?? "").toLowerCase();
      const name = src.includes("linkedin") ? "LinkedIn" : src.includes("indeed") ? "Indeed" : src.includes("google") ? "Google" : "Company website";
      if (!f.options?.length) return { value: name };
      return val(optionLike(f.options, [new RegExp(name, "i"), /job board/i, /website|careers? (page|site)/i, /online|internet/i, /other/i]));
    },
  },
  {
    id: "referral",
    match: has(/referr(ed|al)|who referred|employee referral|referred by/i),
    answer: (f) => (f.options?.length || f.type === "checkbox" ? yesNo(f, false) : skip()),
  },
  {
    id: "pronouns",
    match: has(/pronoun/i),
    answer: (f, ctx) => factAnswer(f, ctx.facts.pronouns, [new RegExp(`^${ctx.facts.pronouns.split("/")[0]}\\b`, "i")]),
  },
  {
    id: "phone-country-code",
    match: has(/(country|dial(ling)?|calling|phone) code/i),
    answer: (f, ctx) => {
      const code = ctx.profile.phone.match(/^\+\d{1,3}/)?.[0];
      if (!code) return null;
      if (!f.options?.length) return { value: code };
      return val(optionLike(f.options, [new RegExp(`\\${code}\\b`), new RegExp(ctx.facts.country, "i")]));
    },
  },
  {
    id: "nationality",
    match: has(/nationality|citizenship$/i),
    answer: (f, ctx) => factAnswer(f, ctx.facts.nationality, [new RegExp(ctx.facts.nationality, "i"), new RegExp(ctx.facts.country, "i")]),
  },
  {
    id: "country",
    match: has(/^(country|country of residence|current country|country\/region|which country (do )?you (live|reside|are based)|country you (live|reside|are based) in|country of (current )?residence)\b/i),
    answer: (f, ctx) => factAnswer(f, ctx.facts.country, [new RegExp(`^${ctx.facts.country}`, "i")]),
  },
  {
    id: "time-zone",
    match: has(/time ?zone/i),
    answer: (f, ctx) =>
      f.options?.length
        ? val(optionLike(f.options, [/\+0?5(:00)?\b/, /pakistan|karachi|pkt/i, new RegExp(ctx.facts.timezone.split(/[ (]/)[0] || "^$", "i")]))
        : val(ctx.facts.timezone),
  },
  {
    id: "hours-overlap",
    match: has(/overlap|(working|business|office|core) hours|\b(est|pst|cet|gmt|utc|us|eu|european|american|pacific|eastern) (time ?zone|time|hours)\b|work (in|during|across) .{0,30}(hours|time ?zones?)/i),
    answer: (f, ctx) => (f.type === "text" || f.type === "textarea" ? val(ctx.facts.hoursOverlap) : yesNo(f, true)),
  },
  {
    id: "employment-type",
    match: has(/(employment|job|engagement|contract|work) type|type of (employment|role|position|contract)|full[- ]time|part[- ]time|\bcontract(or)?\b.*(basis|role|position)|freelance/i),
    answer: (f, ctx, l) => {
      const types = ctx.facts.employmentTypes;
      if (f.options?.length && f.options.some((o) => /full|part|contract|intern|freelance|temporary|permanent/i.test(o))) {
        const wanted = f.options.filter((o) => types.some((t) => o.toLowerCase().includes(t.toLowerCase().replace("-", " ")) || o.toLowerCase().includes(t.toLowerCase())) || (types.includes("Full-time") && /permanent/i.test(o)));
        if (!wanted.length) return null;
        return { value: f.type === "checkbox" ? wanted : wanted[0] };
      }
      const asked = types.find((t) => new RegExp(t.replace("-", "[- ]?"), "i").test(l));
      return yesNo(f, !!asked);
    },
  },
  {
    id: "english",
    match: has(/\benglish\b/i),
    answer: (f, ctx, l) => {
      if (!f.options?.length || f.options.every((o) => YES.concat(NO).some((re) => re.test(o)))) {
        return /^(do|are|can|is)\b/i.test(l.trim()) || f.type === "checkbox" || f.options?.length ? yesNo(f, true) : val(ctx.facts.english);
      }
      return val(optionLike(f.options, [new RegExp(`^${ctx.facts.english}`, "i"), /native|bilingual/i, /fluent/i, /full professional/i, /professional/i, /advanced|\bc2\b|\bc1\b/i]));
    },
  },
  {
    id: "languages",
    match: has(/languages? (do )?you (speak|know)|languages? known|other languages|which languages|languages spoken/i),
    answer: (_f, ctx) => val(ctx.facts.languages),
  },
  {
    id: "gender",
    match: has(/\bgender\b|\bsex\b/i),
    answer: (f, ctx) => {
      const g = ctx.facts.gender;
      const extra = /^male$/i.test(g) ? [/^male\b/i, /^man\b/i, /\bman\b/i] : /^female$/i.test(g) ? [/^female\b/i, /^woman\b/i] : [];
      return factAnswer(f, g, extra);
    },
  },
  {
    id: "transgender",
    match: has(/transgender|\btrans\b|gender identity (differ|same)/i),
    answer: (f, ctx) => factAnswer(f, ctx.facts.transgender),
  },
  {
    id: "orientation",
    match: has(/sexual orientation|lgbt/i),
    answer: (f, ctx) => factAnswer(f, ctx.facts.orientation),
  },
  {
    id: "hispanic",
    match: has(/hispanic|latin[oax]/i),
    answer: (f, ctx) => factAnswer(f, ctx.facts.hispanic, [/not hispanic/i]),
  },
  {
    id: "ethnicity",
    match: has(/\brace\b|ethnic/i),
    answer: (f, ctx) => {
      const e = ctx.facts.ethnicity;
      const extra = e && !DECLINE.some((re) => re.test(e)) ? [new RegExp(`^${e}\\b`, "i"), new RegExp(`\\b${e}\\b`, "i")] : [];
      return factAnswer(f, e, extra);
    },
  },
  {
    id: "veteran",
    match: has(/veteran|military|armed forces|uniformed service/i),
    answer: (f, ctx) => factAnswer(f, ctx.facts.veteran, [/not a (protected )?veteran/i, /i am not\b/i, /^no\b/i]),
  },
  {
    id: "disability",
    match: has(/disabilit|impairment|handicap/i),
    answer: (f, ctx) => factAnswer(f, ctx.facts.disability, [/^no,? i (do not|don't) have/i, /(do not|don't) have a disability/i, /^no\b/i]),
  },
  {
    id: "postal-code",
    match: has(/(postal|zip|post) ?code|postcode/i),
    answer: (_f, ctx) => (ctx.facts.postalCode ? { value: ctx.facts.postalCode } : skip()),
  },
  {
    id: "address",
    match: has(/^(street )?address( line)?( 1)?$|street address|home address|residential address|mailing address|^address line 2$/i),
    answer: (_f, ctx, l) => (/line 2/i.test(l) || !ctx.facts.address ? skip() : { value: ctx.facts.address }),
  },
  {
    id: "region",
    match: has(/^(state|province|region|state\/province|state or province)\b/i),
    answer: (f, ctx) => (ctx.facts.region ? factAnswer(f, ctx.facts.region, [new RegExp(ctx.facts.region.split(" ")[0], "i")]) : null),
  },
  {
    id: "city",
    match: has(/^(city|town|current city|city of residence|home city|city\/town|location \(city\)|your city)\b|^(current )?location$|where are you (currently )?(based|located|living)|^your location$/i),
    answer: (f, ctx, l) => {
      const { city, country } = ctx.facts;
      if (!city) return null;
      if (f.options?.length) return val(optionLike(f.options, [new RegExp(`^${city}`, "i"), new RegExp(city, "i")]));
      return { value: /city|town/i.test(l) ? city : [city, country].filter(Boolean).join(", ") };
    },
  },
  {
    id: "cover-letter",
    match: (l, f) => f.type === "textarea" && /cover(ing)? letter|motivation(al)? letter|letter of motivation/i.test(l),
    answer: (_f, ctx) => (ctx.job.cover?.trim() ? { value: ctx.job.cover.trim(), maxWords: 1000 } : null),
  },
  {
    // Last: a consent box that no rule above claimed.
    id: "consent",
    match: (l, f) => (f.type === "checkbox" || !!f.options?.length) && CONSENT.test(l) && !MARKETING.test(l),
    answer: (f) => yesNo(f, true),
  },
];

/** Answers one field from the bank, or null when no rule knows it. */
export function bankAnswer(field: FormField, ctx: BankContext): BankAnswer | null {
  const label = field.label.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim();
  if (!label) return null;
  for (const rule of RULES) {
    if (!rule.match(label, field)) continue;
    const out = rule.answer(field, ctx, label);
    if (out) return { rule: rule.id, ...out };
    // The question was recognised but this rule could not answer it; later rules may.
  }
  return null;
}

export const BANK_RULE_IDS = RULES.map((r) => r.id);
