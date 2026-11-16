import type { Profile } from "@/lib/cv/types";
import { linkKey } from "@/lib/pipeline/dedupe";

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
export type FieldAnswer = { id: string; value: FieldValue; source: "profile" | "ai" | "none" };
export type SavedAnswer = { question: string; answer: string };

const MAX_FIELDS = 60;
const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const TYPES = new Set<string>(["text", "textarea", "number", "email", "tel", "url", "date", "select", "radio", "checkbox", "file"]);

/** Normalises what the extension sends; anything malformed is dropped. */
export function parseFields(input: unknown): FormField[] {
  if (!Array.isArray(input)) return [];
  const out: FormField[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, MAX_FIELDS)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = clean(r.id, 80);
    const type = clean(r.type, 20);
    if (!id || seen.has(id) || !TYPES.has(type)) continue;
    seen.add(id);
    const options = Array.isArray(r.options)
      ? r.options.map((o) => clean(o, 160)).filter(Boolean).slice(0, 300)
      : undefined;
    const maxLength = Number(r.maxLength);
    out.push({
      id,
      label: clean(r.label, 400),
      type: type as FormField["type"],
      ...(options?.length ? { options } : {}),
      ...(r.required ? { required: true } : {}),
      ...(maxLength > 0 ? { maxLength } : {}),
    });
  }
  return out;
}

const linkTo = (profile: Profile, re: RegExp) =>
  profile.links.find((l) => re.test(l.label) || re.test(l.url))?.url ?? "";

/** Contact details answered straight from the profile, with no AI involved. */
export function profileAnswer(field: FormField, profile: Profile): string | null {
  if (field.options?.length || field.type === "checkbox" || field.type === "file" || field.type === "textarea") {
    return null;
  }
  const label = field.label.toLowerCase();
  // Contact fields have short labels; a long one is a real question for the AI step.
  if (label.length > 40) return null;
  const names = profile.name.trim().split(/\s+/);
  let value = "";
  if (field.type === "email" || /\be-?mail\b/.test(label)) value = profile.email;
  else if (field.type === "tel" || /\b(phone|mobile|contact number)\b/.test(label)) value = profile.phone;
  else if (/\blinkedin\b/.test(label)) value = linkTo(profile, /linkedin/i);
  else if (/\bgithub\b/.test(label)) value = linkTo(profile, /github/i);
  else if (/\b(portfolio|personal (web)?site|website)\b/.test(label)) value = linkTo(profile, /portfolio|website|site/i);
  else if (/\bfirst name\b|\bgiven name\b/.test(label)) value = names[0] ?? "";
  else if (/\b(last name|surname|family name)\b/.test(label)) value = names.length > 1 ? names.slice(1).join(" ") : "";
  else if (/^(full |legal |your )?name\b/.test(label) && !/company|employer|school|university|referr/.test(label)) value = profile.name;
  return value.trim() || null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const BLANK = /^(leave blank|n\/?a|unknown|not (stated|available|sure)|null|none)?$/i;

/**
 * Makes an answer safe to put in a form: choices must be real options,
 * numbers must be numbers, and text respects the field's length limit.
 * Returns null when the field should be left for the user.
 */
export function validateAnswer(field: FormField, value: unknown): FieldValue {
  if (field.type === "file") return null;

  if (field.options?.length) {
    const pickOption = (v: unknown) => field.options!.find((o) => same(o, String(v ?? ""))) ?? null;
    if (field.type === "checkbox") {
      const picked = (Array.isArray(value) ? value : [value]).map(pickOption).filter((o): o is string => !!o);
      return picked.length ? [...new Set(picked)] : null;
    }
    return pickOption(Array.isArray(value) ? value[0] : value);
  }

  if (Array.isArray(value) || value === null || value === undefined) return null;
  const text = String(value).trim();
  if (BLANK.test(text)) return null;

  if (field.type === "checkbox") return /^(yes|true)$/i.test(text) ? "yes" : null;
  if (field.type === "number") {
    const n = text.replace(/,/g, "");
    return /^-?\d+(\.\d+)?$/.test(n) ? n : null;
  }
  if (field.type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  if (field.type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
  if (field.type === "url") return /^https?:\/\/\S+$/i.test(text) ? text : null;
  if (field.maxLength && text.length > field.maxLength) {
    // A cut-off sentence reads worse than an empty box the user fills in.
    return field.type === "textarea" ? null : text.slice(0, field.maxLength);
  }
  return text;
}

type JobLink = { id: string; link: string | null; sourceId?: string | null };

/** Finds the saved job a browser tab belongs to, by its listing link. */
export function matchJob<T extends JobLink>(url: string, jobs: T[]): T | null {
  const key = linkKey(url);
  if (!key) return null;
  const exact = jobs.find((j) => j.link && linkKey(j.link) === key);
  if (exact) return exact;
  // LinkedIn shows one posting under several URL shapes; the numeric id is stable.
  const tabId = /linkedin\.com/i.test(url) ? linkedInId(url) : null;
  if (tabId) {
    return jobs.find((j) => j.link && /linkedin\.com/i.test(j.link) && linkedInId(j.link) === tabId) ?? null;
  }
  return null;
}

function linkedInId(url: string): string | null {
  const fromQuery = url.match(/[?&]currentJobId=(\d{6,})/)?.[1];
  if (fromQuery) return fromQuery;
  const path = url.split(/[?#]/)[0];
  return path.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})\/?$/)?.[1] ?? null;
}
