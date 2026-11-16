import type { SearchLocation } from "@/lib/settings";
import { truncate } from "@/lib/util";
import { runActor } from "./apify";
import type { RawJob } from "./types";

export type SearchInput = {
  title: string;
  location: SearchLocation;
  postedWithinDays: 1 | 7 | 30;
  limit: number;
  excludeTitleWords: string[];
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// ---------- LinkedIn ----------

type LinkedInItem = {
  id?: string;
  title?: string;
  companyName?: string;
  companyUrl?: string;
  location?: string;
  description?: string;
  salary?: string;
  url?: string;
  workType?: string;
  sector?: string;
  recruiterName?: string;
  recruiterUrl?: string;
};

export async function searchLinkedIn(s: SearchInput): Promise<RawJob[]> {
  const datePosted =
    s.postedWithinDays === 1 ? "r86400" : s.postedWithinDays === 7 ? "r604800" : "r2592000";
  const items = await runActor<LinkedInItem>(
    "linkedin",
    {
      keywords: s.location.remote ? `${s.title} remote` : s.title,
      location: s.location.linkedin,
      datePosted,
      limit: s.limit,
      ...(s.excludeTitleWords.length ? { titleExclude: s.excludeTitleWords } : {}),
    },
    s.limit,
  );
  return items
    .filter((i) => str(i.title) && str(i.companyName) && str(i.url))
    .map((i) => ({
      source: "LinkedIn" as const,
      sourceId: str(i.id) || str(i.url),
      company: str(i.companyName),
      role: str(i.title),
      link: str(i.url).split("?")[0],
      location: str(i.location),
      description: str(i.description),
      pay: str(i.salary),
      // This actor's "workType" field holds the company's industry, not remote/onsite.
      mode: /\bremote\b/i.test(`${str(i.title)} ${str(i.location)}`) ? "Remote" : "",
      tier: s.location.label,
      company_: {
        linkedin: str(i.companyUrl).split("?")[0],
        industry: str(i.workType) || str(i.sector),
      },
      recruiter: str(i.recruiterName)
        ? { name: str(i.recruiterName), linkedin: str(i.recruiterUrl).split("?")[0] }
        : undefined,
    }));
}

// ---------- Indeed ----------

type IndeedItem = {
  id?: string;
  title?: { text?: string };
  company?: {
    name?: string;
    size?: string | null;
    industry?: string | null;
    briefDescription?: string | null;
    addresses?: string[];
    urls?: { website?: string | null };
  };
  location?: { formatted?: string };
  description?: { text?: string };
  salary?: { text?: string | null };
  urls?: { indeed?: string; external?: string };
  workArrangement?: { isRemote?: boolean; locationType?: string | null };
};

export async function searchIndeed(s: SearchInput): Promise<RawJob[]> {
  if (!s.location.indeedCountry) return [];
  const exclusions = s.excludeTitleWords.map((w) => `-${w}`).join(" ");
  const fromDays = s.postedWithinDays === 1 ? "1" : s.postedWithinDays === 7 ? "7" : "14";
  const items = await runActor<IndeedItem>(
    "indeed",
    {
      keyword: [s.title, s.location.remote ? "remote" : "", exclusions].filter(Boolean).join(" "),
      location: s.location.indeedLocation,
      country: s.location.indeedCountry,
      maxItems: s.limit,
      sort: "date",
      fromDays,
      searchMode: "basic",
      proxyConfig: { useApifyProxy: true },
    },
    s.limit,
  );
  return items
    .filter((i) => str(i.title?.text) && str(i.company?.name))
    .map((i) => ({
      source: "Indeed" as const,
      sourceId: str(i.id),
      company: str(i.company?.name),
      role: str(i.title?.text),
      link: str(i.urls?.indeed) || str(i.urls?.external),
      location: str(i.location?.formatted),
      description: str(i.description?.text),
      pay: str(i.salary?.text ?? ""),
      mode: i.workArrangement?.isRemote ? "Remote" : str(i.workArrangement?.locationType ?? ""),
      tier: s.location.label,
      company_: {
        website: str(i.company?.urls?.website ?? ""),
        size: str(i.company?.size ?? ""),
        industry: str(i.company?.industry ?? ""),
        about: str(i.company?.briefDescription ?? ""),
        address: str(i.company?.addresses?.[0] ?? ""),
      },
    }))
    .filter((j) => j.link);
}

// ---------- Google (company career boards) ----------

type SerpRow = {
  search_term?: string;
  results?: { title?: string; url?: string; description?: string }[];
};

// One query per board: the search actor drops parentheses, so a combined
// "(site:a OR site:b)" query leaks results from unrelated sites.
const BOARDS = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "apply.workable.com",
];

const pretty = (slugged: string) =>
  slugged
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

/** Works out company and role from a career-board URL and its page title. */
export function parseBoardResult(
  url: string,
  title: string,
): { company: string; role: string; sourceId: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const t = title.replace(/\s+/g, " ").trim();
  let company = "";
  let role = "";

  if (host.endsWith("greenhouse.io")) {
    if (parts.length < 3 || parts[1] !== "jobs") return null;
    const m = t.match(/^(?:Job Application for\s+)?(.+?)\s+at\s+(.+)$/i);
    role = m?.[1] ?? "";
    company = m?.[2] ?? pretty(parts[0]);
  } else if (host === "jobs.lever.co") {
    if (parts.length < 2) return null;
    const m = t.match(/^(.+?)\s+[-–]\s+(.+)$/);
    company = m?.[1] ?? pretty(parts[0]);
    role = m?.[2] ?? "";
  } else if (host === "jobs.ashbyhq.com") {
    if (parts.length < 2) return null;
    const m = t.match(/^(.+?)\s+(?:@|[-–])\s+(.+)$/);
    role = m?.[1] ?? "";
    company = m?.[2] ?? pretty(parts[0]);
  } else if (host === "apply.workable.com") {
    if (parts.length < 3 || parts[1] !== "j") return null;
    const m = t.match(/^(.+?)\s+[-–]\s+(.+)$/);
    role = m?.[1] ?? "";
    company = m?.[2] ?? pretty(parts[0]);
  } else {
    return null;
  }

  company = company.replace(/\s*[|·].*$/, "").trim() || pretty(parts[0]);
  role = role.replace(/\s*[|·].*$/, "").trim();
  if (!role) return null;
  return { company, role, sourceId: `${host}${u.pathname}` };
}

/** One Google query per title and board, limited to public applicant-tracking boards. */
export async function searchGoogle(
  titles: string[],
  opts: { remoteOnly: boolean; postedWithinDays: 1 | 7 | 30; tier: string; excludeTitleWords: string[] },
): Promise<RawJob[]> {
  if (!titles.length) return [];
  const queries = titles.flatMap((t) =>
    BOARDS.map((board) => `"${t}" ${opts.remoteOnly ? "remote " : ""}site:${board}`),
  );
  const tbs = opts.postedWithinDays === 1 ? "qdr:d" : opts.postedWithinDays === 7 ? "qdr:w" : "qdr:m";
  const rows = await runActor<SerpRow>(
    "google",
    { keyword: queries.join("\n"), limit: "10", include_merged: false, tbs, hl: "en" },
    queries.length,
    (r) => r.length,
  );

  const excluded = opts.excludeTitleWords.map((w) => w.toLowerCase());
  const jobs: RawJob[] = [];
  for (const row of rows) {
    for (const r of row.results ?? []) {
      const parsed = parseBoardResult(str(r.url), str(r.title));
      if (!parsed) continue;
      if (excluded.some((w) => parsed.role.toLowerCase().includes(w))) continue;
      jobs.push({
        source: "Google",
        sourceId: parsed.sourceId,
        company: parsed.company,
        role: parsed.role,
        link: str(r.url).split("?")[0],
        location: opts.remoteOnly ? "Remote" : "",
        description: truncate(str(r.description), 600),
        pay: "",
        mode: opts.remoteOnly ? "Remote" : "",
        tier: opts.tier,
        company_: {},
      });
    }
  }
  return jobs;
}
