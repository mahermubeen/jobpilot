import type { Profile } from "@/lib/cv/types";
import type { ApplyFacts } from "@/lib/settings";
import type { FormField } from "./answers";
import { escapeRegExp as esc } from "@/lib/util";
import { authorisationText, authorisedIn, countriesIn, experienceTopic, isStatusList, questionCountries, statusAnswer, techYears, timeZonePatterns } from "./bank-facts";
import {
  DECLINE,
  durationAnswer,
  factAnswer,
  NO,
  numberAnswer,
  optionLike,
  parseCvDate,
  type Shaped,
  skip,
  val,
  YES,
  yesNo,
} from "./bank-shapes";
import { resolveSalary, salaryQuestion, type SalaryJob } from "./salary";

/**
 * The question bank: the questions application forms ask again and again,
 * answered from your profile and facts with no AI. A rule returns null when
 * it cannot answer; the field then goes on to saved answers, learned answers
 * and, last, the AI.
 */

export type BankJob = SalaryJob & { id?: string; source?: string | null; cover?: string | null };
export type BankContext = { profile: Profile; facts: ApplyFacts; job: BankJob; now?: Date };

export type BankAnswer = Shaped & { rule: string };

export { countriesIn, experienceTopic, techYears } from "./bank-facts";
export { parseCvDate, pickNumberOption } from "./bank-shapes";

type Rule = { id: string; match: (label: string, field: FormField) => boolean; answer: (field: FormField, ctx: BankContext, label: string) => Shaped | null };

// ---------- the rules ----------

const has = (re: RegExp) => (label: string) => re.test(label);

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
      const countries = questionCountries(l, ctx.job.location);
      if (!countries.length) return null;
      const authorised = countries.every((c) => authorisedIn(c, ctx.facts));
      return yesNo(f, !authorised);
    },
  },
  {
    id: "work-authorisation",
    match: has(/authori[sz](ed|ation)|eligib\w* to work|legally (able|allowed|permitted|entitled)? ?(to )?work|right to work|work (permit|visa)|permission to work|visa status|immigration status|citizen/i),
    answer: (f, ctx, l) => {
      if (/remote(ly)? from|from your (current )?(country|location)/i.test(l)) return yesNo(f, true);
      const countries = questionCountries(l, ctx.job.location);
      const authorised = countries.length ? countries.every((c) => authorisedIn(c, ctx.facts)) : null;
      if (isStatusList(f)) return statusAnswer(f.options!, authorised);
      if (f.type === "text" || f.type === "textarea") return authorisationText(l, authorised, ctx.facts.authorizedCountries);
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
      return val(optionLike(f.options, [new RegExp(esc(name), "i"), /job board/i, /website|careers? (page|site)/i, /online|internet/i, /other/i]));
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
    answer: (f, ctx) => factAnswer(f, ctx.facts.pronouns, [new RegExp(`^${esc(ctx.facts.pronouns.split("/")[0])}\\b`, "i")]),
  },
  {
    id: "phone-country-code",
    match: has(/(country|dial(ling)?|calling|phone) code/i),
    answer: (f, ctx) => {
      const code = ctx.profile.phone.match(/^\+\d{1,3}/)?.[0];
      if (!code) return null;
      if (!f.options?.length) return { value: code };
      return val(optionLike(f.options, [new RegExp(`${esc(code)}\\b`), new RegExp(esc(ctx.facts.country), "i")]));
    },
  },
  {
    id: "nationality",
    match: has(/nationality|citizenship$/i),
    answer: (f, ctx) => factAnswer(f, ctx.facts.nationality, [new RegExp(esc(ctx.facts.nationality), "i"), new RegExp(esc(ctx.facts.country), "i")]),
  },
  {
    id: "country",
    match: has(/^(country|country of residence|current country|country\/region|which country (do )?you (live|reside|are based)|country you (live|reside|are based) in|country of (current )?residence)\b/i),
    answer: (f, ctx) => factAnswer(f, ctx.facts.country, [new RegExp(`^${esc(ctx.facts.country)}`, "i")]),
  },
  {
    id: "time-zone",
    match: has(/time ?zone/i),
    answer: (f, ctx) => {
      const tz = ctx.facts.timezone.trim();
      if (!tz) return null;
      return f.options?.length ? val(optionLike(f.options, timeZonePatterns(tz, ctx.now))) : val(tz);
    },
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
      const asked = types.find((t) => new RegExp(esc(t).replace("-", "[- ]?"), "i").test(l));
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
      return val(optionLike(f.options, [new RegExp(`^${esc(ctx.facts.english)}`, "i"), /native|bilingual/i, /fluent/i, /full professional/i, /professional/i, /advanced|\bc2\b|\bc1\b/i]));
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
      const extra = e && !DECLINE.some((re) => re.test(e)) ? [new RegExp(`^${esc(e)}\\b`, "i"), new RegExp(`\\b${esc(e)}\\b`, "i")] : [];
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
    answer: (f, ctx) => (ctx.facts.region ? factAnswer(f, ctx.facts.region, [new RegExp(esc(ctx.facts.region.split(" ")[0]), "i")]) : null),
  },
  {
    id: "city",
    match: has(/^(city|town|current city|city of residence|home city|city\/town|location \(city\)|your city)\b|^(current )?location$|where are you (currently )?(based|located|living)|^your location$/i),
    answer: (f, ctx, l) => {
      const { city, country } = ctx.facts;
      if (!city) return null;
      if (f.options?.length) return val(optionLike(f.options, [new RegExp(`^${esc(city)}`, "i"), new RegExp(esc(city), "i")]));
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
