import type { RawJob } from "@/lib/sources/types";
import { norm, slug } from "@/lib/util";

const SUFFIX = /\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|pvt|private|plc|sa|bv|ag)\b\.?/gi;

/** "Acme, Inc.", "ACME", "The Acme" and "acme.io" are the same company. */
export const companyKey = (name: string) =>
  norm(
    name
      .replace(/\.(com|io|ai|co|dev|app|net|org)\b/gi, " ")
      .replace(SUFFIX, " ")
      .replace(/^\s*the\s+/i, " "),
  );

export const companyId = (name: string) => slug(companyKey(name), "company");

/**
 * Names that are not a company: social handles, Craigslist posters, boards that
 * hide the employer. Two jobs from them with the same title are not the same job.
 */
export function placeholderCompany(name: string): boolean {
  const n = name.trim();
  return !companyKey(n) || /^(u\/|@)/.test(n) || /^craigslist poster\b/i.test(n) || /\(HN\)$/.test(n) ||
    /^(jobs?|careers?|hiring|confidential|stealth|stealth (mode|startup)|unknown|undisclosed|anonymous|private|company|employer|recruiter|n\/?a)$/i.test(companyKey(n));
}

const ROLE_WORDS: Record<string, string> = {
  sr: "senior", snr: "senior", jr: "junior", engineer: "developer", dev: "developer", programmer: "developer",
};

/** Tags boards add to a title that do not change the job. */
const ROLE_NOISE = [
  /\(?\b[mfwdx](\s*\/\s*[mfwdx]){1,3}\b\)?/gi, // (m/f/d), m/w/x, f/m/d
  /\(?\ball genders\)?/gi,
  /\bref\s*#?\s*[\w-]*\d[\w-]*/gi, // REF#310267
  /\[[a-z]{0,4}\d+\]/gi, // [HR222]
  /\((copy|remote|hybrid|on-?site|full[- ]time|part[- ]time|contract|[A-Z]{2})\)/gi,
  /[-–|,]\s*(remote( work)?|hybrid|on-?site|full[- ]time|contract)[\s|,–-]*$/gi,
  /\bremote\b/gi,
];

/** "Sr. Full-Stack Engineer (m/f/d) - Remote" and "Senior Fullstack Developer" are the same role. */
export const roleName = (role: string) =>
  norm(ROLE_NOISE.reduce((r, re) => r.replace(re, " "), role))
    .replace(/\bfull stack\b/g, "fullstack")
    .replace(/\bfront end\b/g, "frontend")
    .replace(/\bback end\b/g, "backend")
    .split(" ")
    .map((w) => ROLE_WORDS[w] ?? w)
    .join(" ");

export const roleKey = (company: string, role: string) => `${companyKey(company)}|${roleName(role)}`;

/** Query parameters that only track where a click came from. */
const TRACKING = /^(utm_.*|ref|refid|referrer|trk|trackingid|source|src|from|gh_src|lever-source|lever-origin|fbclid|gclid|mc_[a-z]+|_hs[a-z]+|hsa_.*|campaign|medium|origin|position|pagenum|currentjobid|eboost|lipi|refid)$/i;

/**
 * One key per job posting, whatever link shape a board used: LinkedIn and
 * Indeed job ids, Greenhouse job ids, else the address without tracking
 * parameters.
 */
export function linkKey(link: string | null | undefined): string {
  const raw = (link ?? "").trim();
  if (!raw) return "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw.split("#")[0].replace(/\/+$/, "").toLowerCase();
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const id = path.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})$/)?.[1] ?? u.searchParams.get("currentJobId");
    if (id) return `linkedin:${id}`;
  }
  if (/(^|\.)indeed\.[a-z.]+$/.test(host)) {
    const jk = u.searchParams.get("jk") ?? u.searchParams.get("vjk");
    if (jk) return `indeed:${jk.toLowerCase()}`;
  }
  const gh = u.searchParams.get("gh_jid") ?? (/greenhouse\.io$/.test(host) ? path.match(/\/jobs\/(\d+)$/)?.[1] : null);
  if (gh) return `greenhouse:${gh}`;
  const params = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params)}` : "";
  return `${host}${path}${query}`.toLowerCase();
}

/** A link without any query: for matching a browser tab to a saved job. */
export const pageKey = (link: string | null | undefined) =>
  (link ?? "").split(/[?#]/)[0].replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();

export type KnownJob = {
  company: string;
  role: string;
  link: string | null;
  source: string | null;
  sourceId: string | null;
};

/** Every key that identifies a job: its id on the board, its link and, for a real company, company + role. */
export function jobKeys(j: { company: string; role: string; link?: string | null; source?: string | null; sourceId?: string | null }): string[] {
  const keys: string[] = [];
  if (j.source && j.sourceId) keys.push(`id:${j.source}|${j.sourceId}`);
  const link = linkKey(j.link);
  if (link) keys.push(`link:${link}`);
  if (!placeholderCompany(j.company) && roleName(j.role)) keys.push(`role:${roleKey(j.company, j.role)}`);
  return keys;
}

const filled = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string" ? v.trim() : v != null)) as Partial<T>;

/** One job seen on two sources: keeps the fuller details and notes where else it was listed. */
export function mergeJobs(a: RawJob, b: RawJob): RawJob {
  const alsoOn = [...new Set([...(a.alsoOn ?? []), ...(b.source !== a.source ? [b.source] : []), ...(b.alsoOn ?? [])])]
    .filter((s) => s !== a.source);
  return {
    ...a,
    description: (b.description?.length ?? 0) > (a.description?.length ?? 0) ? b.description : a.description,
    pay: a.pay || b.pay,
    location: a.location || b.location,
    mode: a.mode || b.mode,
    posted: a.posted || b.posted,
    applyUrl: a.applyUrl || b.applyUrl,
    company_: { ...filled(b.company_), ...filled(a.company_) },
    recruiter: a.recruiter ?? b.recruiter,
    alsoOn: alsoOn.length ? alsoOn : undefined,
  };
}

/**
 * Drops postings already stored or deleted before (same board id, same link,
 * or same company and role). Repeats inside the new batch are merged into the
 * first one. `blocked` holds extra keys to drop, e.g. from deleted jobs.
 */
export function dedupeJobs(incoming: RawJob[], existing: KnownJob[], blocked: Iterable<string> = []): RawJob[] {
  const known = new Set<string>(blocked);
  for (const j of existing) for (const k of jobKeys(j)) known.add(k);

  const fresh: RawJob[] = [];
  const at = new Map<string, number>();
  for (const j of incoming) {
    const keys = jobKeys(j);
    if (keys.some((k) => known.has(k))) continue;
    const seen = keys.map((k) => at.get(k)).find((i) => i !== undefined);
    if (seen !== undefined) {
      fresh[seen] = mergeJobs(fresh[seen], j);
      for (const k of keys) at.set(k, seen);
      continue;
    }
    for (const k of keys) at.set(k, fresh.length);
    fresh.push(j);
  }
  return fresh;
}

/** How far along a job is; the copy to keep among duplicates is the furthest. */
const PROGRESS = ["Skipped", "Found", "Drafted", "Rejected", "Applied", "Replied", "Interview", "Offer"];

type Stored = KnownJob & { id: string; status: string; alsoOn?: string[] | null };

/**
 * Groups saved jobs that are the same posting. Each group's `keep` is the
 * copy furthest along; `extra` are the others.
 */
export function findDuplicates<T extends Stored>(jobs: T[]): { keep: T; extra: T[] }[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const owner = new Map<string, string>();
  for (const j of jobs) parent.set(j.id, j.id);
  for (const j of jobs) {
    for (const k of jobKeys(j)) {
      const other = owner.get(k);
      if (other) parent.set(find(j.id), find(other));
      else owner.set(k, j.id);
    }
  }
  const groups = new Map<string, T[]>();
  for (const j of jobs) {
    const root = find(j.id);
    groups.set(root, [...(groups.get(root) ?? []), j]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const sorted = [...g].sort((a, b) => PROGRESS.indexOf(b.status) - PROGRESS.indexOf(a.status));
      return { keep: sorted[0], extra: sorted.slice(1) };
    });
}

/** A readable, unique id for a new job row. */
export function jobId(company: string, role: string, taken: Set<string>): string {
  const base = slug(`${company} ${role}`, "job");
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}
