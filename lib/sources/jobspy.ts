import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { SearchLocation } from "@/lib/settings";
import { truncate } from "@/lib/util";
import { excludedTitle } from "./match";
import { isoDate, payText, type SourceContext, str } from "./net";
import type { RawJob } from "./types";

/**
 * Free scraping of the big job boards on this computer with JobSpy
 * (github.com/speedyapply/JobSpy). `uvx` fetches Python and JobSpy on first
 * use, so there is nothing to install by hand beyond uv itself.
 */

export const JOBSPY_SITES = ["linkedin", "indeed", "glassdoor", "google", "zip_recruiter", "naukri", "bayt"] as const;
export type JobSpySite = (typeof JOBSPY_SITES)[number];

export const SITE_LABEL: Record<JobSpySite, string> = {
  linkedin: "LinkedIn",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
  google: "Google Jobs",
  zip_recruiter: "ZipRecruiter",
  naukri: "Naukri",
  bayt: "Bayt",
};

const MENA = new Set(["AE", "SA", "QA", "KW", "BH", "OM", "EG", "JO", "LB", "MA", "TN", "DZ", "PK", "IQ"]);
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** The country name JobSpy expects for an Indeed country code. */
export function jobSpyCountry(code: string): string {
  const c = code.trim().toUpperCase();
  if (!c) return "";
  if (c === "US") return "usa";
  if (c === "GB" || c === "UK") return "uk";
  return (regionNames.of(c) ?? "").toLowerCase();
}

/** Whether a site covers a search location at all. */
export function siteCovers(site: JobSpySite, loc: SearchLocation): boolean {
  const c = loc.indeedCountry.trim().toUpperCase();
  switch (site) {
    case "indeed":
    case "glassdoor":
      return !!c;
    case "zip_recruiter":
      return c === "US" || c === "CA";
    case "naukri":
      return c === "IN";
    case "bayt":
      return MENA.has(c);
    default:
      return true;
  }
}

type Query = {
  id: string;
  site: JobSpySite;
  search_term: string;
  location: string;
  is_remote: boolean;
  results_wanted: number;
  hours_old: number;
  country: string;
  google_search_term?: string;
};

export function buildQueries(ctx: Pick<SourceContext, "boardTitles" | "locations" | "postedWithinDays" | "limit">, sites: JobSpySite[]) {
  const queries: (Query & { tier: string })[] = [];
  for (const loc of ctx.locations) {
    for (const title of ctx.boardTitles) {
      for (const site of sites) {
        if (!siteCovers(site, loc)) continue;
        const country = jobSpyCountry(loc.indeedCountry);
        const worldwide = /\b(worldwide|anywhere|global)\b/i.test(loc.linkedin);
        // LinkedIn reads its own location names; the other boards want a place inside the country.
        const location =
          site === "linkedin" ? loc.linkedin : loc.indeedLocation || (worldwide ? "" : loc.linkedin || country);
        const place = loc.remote ? "remote" : location ? `in ${location}` : "";
        queries.push({
          id: String(queries.length),
          site,
          search_term: title,
          location,
          is_remote: loc.remote,
          results_wanted: ctx.limit,
          hours_old: ctx.postedWithinDays * 24,
          country,
          google_search_term: site === "google"
            ? `${title} jobs ${place} ${ctx.postedWithinDays === 1 ? "since yesterday" : "in the last week"}`.replace(/\s+/g, " ").trim()
            : undefined,
          tier: loc.label,
        });
      }
    }
  }
  return queries;
}

export type JobSpyRow = {
  id?: string;
  site?: string;
  job_url?: string;
  job_url_direct?: string | null;
  title?: string;
  company?: string | null;
  location?: string | null;
  date_posted?: string | null;
  interval?: string | null;
  min_amount?: number | null;
  max_amount?: number | null;
  currency?: string | null;
  is_remote?: boolean | null;
  description?: string | null;
  company_industry?: string | null;
  company_url?: string | null;
  company_url_direct?: string | null;
  company_addresses?: string | null;
  company_num_employees?: string | null;
  company_description?: string | null;
  _query?: string;
};

export function mapJobSpyRow(r: JobSpyRow, tier: string): RawJob | null {
  const site = (r.site ?? "") as JobSpySite;
  const role = str(r.title);
  const company = str(r.company);
  const link = str(r.job_url);
  if (!role || !company || !link || !SITE_LABEL[site]) return null;
  const companyUrl = str(r.company_url);
  return {
    source: SITE_LABEL[site],
    kind: "listing",
    sourceId: str(r.id) || link,
    company,
    role,
    link,
    applyUrl: str(r.job_url_direct) || undefined,
    location: str(r.location),
    description: truncate(str(r.description), 6000),
    pay: payText(r.min_amount, r.max_amount, r.currency, r.interval),
    mode: r.is_remote ? "Remote" : "",
    tier,
    posted: isoDate(r.date_posted),
    company_: {
      website: str(r.company_url_direct) || (companyUrl && !/linkedin\.com|indeed\.com|glassdoor\./.test(companyUrl) ? companyUrl : undefined),
      linkedin: /linkedin\.com/.test(companyUrl) ? companyUrl.split("?")[0] : undefined,
      industry: str(r.company_industry) || undefined,
      size: str(r.company_num_employees) || undefined,
      about: str(r.company_description) ? truncate(str(r.company_description), 600) : undefined,
      address: str(r.company_addresses) || undefined,
    },
  };
}

const uvx = () => (process.env.JOBPILOT_UVX || "uvx").trim();

type Line = { query?: string; jobs?: JobSpyRow[]; error?: string | null };

/**
 * Runs the JobSpy script and returns the result lines it printed. A run that
 * goes past `hardStopMs` is stopped, keeping the lines it had already printed.
 */
function runJobSpy(input: string, hardStopMs: number): Promise<{ lines: Line[]; code: number | null; err: string; stopped: boolean }> {
  const script = path.join(process.cwd(), "scripts", "jobspy_runner.py");
  return new Promise((resolve, reject) => {
    const child = spawn(uvx(), ["--from", "python-jobspy", "python", "-I", script], {
      cwd: process.cwd(),
      // uv installs to ~/.local/bin, which the server's PATH often lacks.
      env: { ...process.env, PATH: `${process.env.PATH ?? ""}${path.delimiter}${path.join(os.homedir(), ".local", "bin")}` },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      child.kill("SIGKILL");
    }, hardStopMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new Error("Free board scraping needs uv. Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh") : e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const lines = out.split("\n").flatMap((l) => {
        try {
          return l.trim().startsWith("{") ? [JSON.parse(l) as Line] : [];
        } catch {
          return [];
        }
      });
      resolve({ lines, code, err, stopped });
    });
    child.stdin.end(input);
  });
}

/**
 * Scrapes the given sites for every board title and location within
 * `budgetMs`. Results and errors come back per site.
 */
export async function searchJobSpy(
  ctx: SourceContext,
  sites: JobSpySite[],
  budgetMs = 15 * 60_000,
): Promise<{ jobs: Partial<Record<JobSpySite, RawJob[]>>; errors: Partial<Record<JobSpySite, string[]>> }> {
  const queries = buildQueries(ctx, sites);
  if (!queries.length) return { jobs: {}, errors: {} };
  // `tier` is ours, not JobSpy's; undefined keys drop out of the JSON.
  const input = JSON.stringify({ queries: queries.map((q) => ({ ...q, tier: undefined })), budget_s: Math.round(budgetMs / 1000) });
  // The script stops starting searches at the budget; this is the backstop for one that hangs.
  const { lines, code, err, stopped } = await runJobSpy(input, budgetMs + 3 * 60_000);
  if (!lines.length) {
    const why = stopped ? "took too long and was stopped" : `stopped (exit ${code})`;
    throw new Error(`JobSpy ${why}: ${truncate(err.trim().split("\n").slice(-3).join(" "), 300) || "no output"}`);
  }

  const byId = new Map(queries.map((q) => [q.id, q]));
  const jobs: Partial<Record<JobSpySite, RawJob[]>> = {};
  const errors: Partial<Record<JobSpySite, string[]>> = {};
  const done = new Set<string>();
  for (const line of lines) {
    const q = byId.get(String(line.query));
    if (!q) continue;
    done.add(q.id);
    if (line.error) (errors[q.site] ??= []).push(`"${q.search_term}" in ${q.tier}: ${line.error}`);
    for (const row of line.jobs ?? []) {
      const job = mapJobSpyRow(row, q.tier);
      if (job && !excludedTitle(job.role, ctx.excludeTitleWords)) (jobs[q.site] ??= []).push(job);
    }
  }
  for (const q of queries) {
    if (!done.has(q.id)) (errors[q.site] ??= []).push(`"${q.search_term}" in ${q.tier}: stopped before it finished`);
  }
  return { jobs, errors };
}
