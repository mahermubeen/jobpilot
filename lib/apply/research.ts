import { stripHtml } from "@/lib/sources/net";
import { fetchPublicText } from "@/lib/sources/safe-url";
import { pickWebsite } from "@/lib/sources/contacts";

/** Research older than this is read again. */
export const RESEARCH_MAX_AGE_DAYS = 30;
const MAX_CHARS = 6000;
const PAGE_CHARS = 1800;
const TIMEOUT_MS = 10_000;
// Pages that usually say what a company sells and who to. The home page comes first.
const PAGES = ["", "/about", "/about-us", "/company", "/product", "/products", "/platform", "/solutions", "/customers"];
const MAX_PAGES = 4;

export type ResearchJob = { company: string; link: string | null; description: string | null };
export type ResearchCompany = {
  website: string | null;
  about: string | null;
  industry: string | null;
  stack: string | null;
  size: string | null;
  research: string | null;
  researchedAt: Date | null;
} | null;

export type Research = {
  /** Text to give the AI. */
  text: string;
  /** Text read from the web this time, to cache on the company; null when the cache was used or nothing was read. */
  fresh: string | null;
};

type Fetcher = (url: string) => Promise<string>;
const defaultFetch: Fetcher = (url) =>
  // Links come from scraped job data, so only public hosts are fetched (no localhost, LAN or metadata IPs).
  fetchPublicText(url, { timeoutMs: TIMEOUT_MS, headers: { accept: "text/html,*/*" } });

/** Visible text of a page, minus nav and footer noise, cut to a size the prompt can carry. */
export function pageText(html: string, max = PAGE_CHARS): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const meta =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ??
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ??
    "";
  const body = stripHtml(html.replace(/<(nav|footer|header|noscript|svg|form)[\s\S]*?<\/\1>/gi, " "))
    .split("\n")
    .map((l) => l.trim())
    // Short lines are menu items and buttons.
    .filter((l) => l.split(/\s+/).length >= 5)
    .join("\n");
  const text = [title, stripHtml(meta), body].filter(Boolean).join("\n");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The company's own site: the known website, or the job link when it points at the company. */
export function siteFor(job: ResearchJob, company: ResearchCompany): string | null {
  const raw = company?.website || (job.link ? pickWebsite(job.company, [job.link]) : null);
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

const fresh = (c: ResearchCompany, now: Date) =>
  !!c?.research &&
  !!c.researchedAt &&
  now.getTime() - new Date(c.researchedAt).getTime() < RESEARCH_MAX_AGE_DAYS * 86_400_000;

/** Short job descriptions are topped up from the job page. */
const THIN_DESCRIPTION = 800;
const POST_CHARS = 3000;

function companyFacts(company: ResearchCompany): string[] {
  return [
    company?.about && `About: ${company.about}`,
    company?.industry && `Industry: ${company.industry}`,
    company?.size && `Size: ${company.size}`,
    company?.stack && `Tech stack: ${company.stack}`,
  ].filter(Boolean) as string[];
}

/** Text of one page, or "" when it is missing, blocked or empty. */
async function tryPage(fetch: Fetcher, url: string, max?: number): Promise<string> {
  try {
    return pageText(await fetch(url), max);
  } catch {
    return "";
  }
}

/**
 * Reads the site's home and about-style pages until MAX_PAGES distinct ones
 * have text. One page at a time on purpose: it stops as soon as there is
 * enough, so a company site gets as few requests as possible.
 */
async function readSite(site: string, fetch: Fetcher): Promise<string> {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const path of PAGES) {
    if (parts.length >= MAX_PAGES) break;
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: stop at MAX_PAGES, fewest requests to the site
    const text = await tryPage(fetch, `${site}${path}`);
    // Many sites answer every path with the home page.
    const key = text.slice(0, 200);
    if (text.length < 40 || seen.has(key)) continue;
    seen.add(key);
    parts.push(`[${path || "/"}]\n${text}`);
  }
  return parts.join("\n\n");
}

const clip = (text: string) => (text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text);

/** Site text: the cached copy while fresh, else read now (and returned as `read` to cache). */
async function siteResearch(job: ResearchJob, company: ResearchCompany, fetch: Fetcher, now: Date) {
  if (fresh(company, now)) return { siteText: company!.research!, read: null };
  const site = siteFor(job, company);
  const text = site ? await readSite(site, fetch) : "";
  return { siteText: text, read: text || null };
}

/**
 * What we know about the company for a cover letter: stored facts, its own site
 * (cached on the company) and, when the saved description is thin, the job post.
 * Never throws: a site that will not answer just means less to go on.
 */
export async function researchCompany(
  job: ResearchJob,
  company: ResearchCompany,
  { fetch = defaultFetch, now = new Date() }: { fetch?: Fetcher; now?: Date } = {},
): Promise<Research> {
  const wantsPost = !!job.link && (job.description ?? "").length < THIN_DESCRIPTION;
  // The site and the job post are independent, so they are read at the same time.
  const [{ siteText, read }, post] = await Promise.all([
    siteResearch(job, company, fetch, now),
    wantsPost ? tryPage(fetch, job.link!, POST_CHARS) : Promise.resolve(""),
  ]);
  const text = [
    companyFacts(company).join("\n"),
    siteText && `From their website:\n${siteText}`,
    post && `From the job post page:\n${post}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { text: clip(text), fresh: read };
}
