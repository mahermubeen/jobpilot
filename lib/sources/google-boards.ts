import { escapeRegExp, truncate } from "@/lib/util";
import { runActor } from "./apify";
import { excludedTitle } from "./match";
import { saysRemote, str } from "./net";
import type { PostedWithin } from "./posted";
import type { RawJob } from "./types";

/** Google searches limited to public applicant-tracking boards, through an Apify actor. */

type SerpRow = {
  search_term?: string;
  results?: { title?: string; url?: string; description?: string }[];
};

// One query per board: the search actor drops parentheses, so a combined
// "(site:a OR site:b)" query leaks results from unrelated sites.
export const BOARDS = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "apply.workable.com",
  "myworkdayjobs.com",
  "jobs.smartrecruiters.com",
  "recruitee.com",
  "teamtailor.com",
  "bamboohr.com/careers",
  "breezy.hr",
  "jobs.personio.de",
  "wellfound.com/jobs",
];

const pretty = (slugged: string) =>
  slugged
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

const firstPart = (t: string) => t.split(/\s+[-–|•@]\s+|\s+at\s+/)[0].trim();

type ResultUrl = { host: string; parts: string[]; sub: string; title: string };
type CompanyRole = { company: string; role: string };

/** "Role at Company" style titles; `roleFirst` says which group is the role. */
function fromTitle(t: string, pattern: RegExp, roleFirst: boolean, fallbackCompany: string): CompanyRole {
  const m = t.match(pattern);
  const [a, b] = [m?.[1], m?.[2]];
  return roleFirst ? { role: a ?? "", company: b ?? fallbackCompany } : { company: a ?? fallbackCompany, role: b ?? "" };
}

const DASH_PAIR = /^(.+?)\s+[-–]\s+(.+)$/;
const SUBDOMAIN_BOARDS = /\.(recruitee\.com|teamtailor\.com|bamboohr\.com|breezy\.hr)$/;
const PERSONIO = /\.jobs\.personio\.(de|com)$/;

function wellfound({ parts, title }: ResultUrl): CompanyRole | null {
  if (parts[0] !== "jobs" || parts.length < 2) return null;
  const m = title.match(/^(.+?)\s+at\s+(.+?)(?:\s+[•|].*)?$/i);
  const company = m?.[2] ?? "";
  return company ? { company, role: m?.[1] ?? firstPart(title) } : null;
}

/** One rule per board: does the host belong to it, and how to read company and role from URL and title. */
const RESULT_RULES: { matches: (host: string) => boolean; parse: (r: ResultUrl) => CompanyRole | null }[] = [
  {
    matches: (h) => h.endsWith("greenhouse.io"),
    parse: ({ parts, title }) =>
      parts.length < 3 || parts[1] !== "jobs" ? null : fromTitle(title, /^(?:Job Application for\s+)?(.+?)\s+at\s+(.+)$/i, true, pretty(parts[0])),
  },
  { matches: (h) => h === "jobs.lever.co", parse: ({ parts, title }) => (parts.length < 2 ? null : fromTitle(title, DASH_PAIR, false, pretty(parts[0]))) },
  {
    matches: (h) => h === "jobs.ashbyhq.com",
    parse: ({ parts, title }) => (parts.length < 2 ? null : fromTitle(title, /^(.+?)\s+(?:@|[-–])\s+(.+)$/, true, pretty(parts[0]))),
  },
  {
    matches: (h) => h === "apply.workable.com",
    parse: ({ parts, title }) => (parts.length < 3 || parts[1] !== "j" ? null : fromTitle(title, DASH_PAIR, true, pretty(parts[0]))),
  },
  {
    matches: (h) => h.endsWith("myworkdayjobs.com"),
    parse: ({ parts, sub, title }) => (parts.includes("job") ? { company: pretty(sub), role: firstPart(title) } : null),
  },
  {
    matches: (h) => h === "jobs.smartrecruiters.com",
    parse: ({ parts, title }) =>
      parts.length < 2 ? null : { company: pretty(parts[0]), role: firstPart(title.replace(new RegExp(`^${escapeRegExp(parts[0])}\\s+`, "i"), "")) },
  },
  {
    matches: (h) => SUBDOMAIN_BOARDS.test(h) || PERSONIO.test(h),
    parse: ({ parts, sub, title }) => (parts.length < 2 ? null : { company: pretty(sub), role: firstPart(title) }),
  },
  { matches: (h) => h === "wellfound.com", parse: wellfound },
];

const dropTail = (s: string) => s.replace(/\s*[|·].*$/, "").trim();

/** Works out company and role from a career-board URL and its page title. */
export function parseBoardResult(url: string, title: string): { company: string; role: string; sourceId: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const result: ResultUrl = { host, parts, sub: host.split(".")[0], title: title.replace(/\s+/g, " ").trim() };
  const found = RESULT_RULES.find((r) => r.matches(host))?.parse(result);
  const role = found ? dropTail(found.role) : "";
  if (!found || !role) return null;
  return { company: dropTail(found.company) || pretty(parts[0]), role, sourceId: `${host}${u.pathname}` };
}

type GoogleOptions = { remoteOnly: boolean; postedWithinDays: PostedWithin; tier: string; excludeTitleWords: string[] };

// Google only knows when it indexed a page, not when the job was posted.
const INDEXED_WITHIN: Record<PostedWithin, string> = { 1: "qdr:d", 3: "qdr:d3", 7: "qdr:w" };

function resultToJob(r: NonNullable<SerpRow["results"]>[number], opts: GoogleOptions): RawJob | null {
  const parsed = parseBoardResult(str(r.url), str(r.title));
  if (!parsed || excludedTitle(parsed.role, opts.excludeTitleWords)) return null;
  const snippet = str(r.description);
  // Only say remote when the page does; the location filter judges the rest.
  const remote = saysRemote(`${parsed.role} ${snippet}`);
  return {
    source: "Google",
    kind: "listing",
    sourceId: parsed.sourceId,
    company: parsed.company,
    role: parsed.role,
    link: str(r.url).split("?")[0],
    location: remote ? "Remote" : "",
    description: truncate(snippet, 600),
    pay: "",
    mode: remote ? "Remote" : "",
    tier: opts.tier,
    company_: {},
  };
}

/** One Google query per title and board, limited to public applicant-tracking boards. */
export async function searchGoogle(titles: string[], opts: GoogleOptions): Promise<RawJob[]> {
  if (!titles.length) return [];
  const queries = titles.flatMap((t) => BOARDS.map((board) => `"${t}" ${opts.remoteOnly ? "remote " : ""}site:${board}`));
  const rows = await runActor<SerpRow>(
    "google",
    { keyword: queries.join("\n"), limit: "10", include_merged: false, tbs: INDEXED_WITHIN[opts.postedWithinDays], hl: "en" },
    queries.length,
    (r) => r.length,
  );
  return rows.flatMap((row) => row.results ?? []).map((r) => resultToJob(r, opts)).filter((j): j is RawJob => !!j);
}
