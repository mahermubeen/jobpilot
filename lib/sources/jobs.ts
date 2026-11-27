import type { SearchLocation } from "@/lib/settings";
import { truncate } from "@/lib/util";
import { runActor } from "./apify";
import { excludedTitle, matchesTitle } from "./match";
import { isoDate, payText, saysRemote, type SourceContext, str, stripHtml } from "./net";
import type { PostedWithin } from "./posted";
import { companyFromText, type Post, postToJob } from "./social";
import type { RawJob } from "./types";

/** Paid job sources, each run through an Apify actor (see actors.ts for ids and prices). */

export type SearchInput = {
  title: string;
  location: SearchLocation;
  postedWithinDays: PostedWithin;
  limit: number;
  excludeTitleWords: string[];
};

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
  postedDate?: string;
  postedTimeAgo?: string;
  applyUrl?: string;
};

export async function searchLinkedIn(s: SearchInput): Promise<RawJob[]> {
  // The actor only offers 24 hours, a week or a month; a 3-day search asks for
  // the week and the posting dates cut it down afterwards.
  const datePosted = s.postedWithinDays === 1 ? "r86400" : "r604800";
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
      source: "LinkedIn",
      kind: "listing" as const,
      sourceId: str(i.id) || str(i.url),
      company: str(i.companyName),
      role: str(i.title),
      link: str(i.url).split("?")[0],
      applyUrl: str(i.applyUrl) || undefined,
      location: str(i.location),
      description: str(i.description),
      pay: str(i.salary),
      // This actor's "workType" field holds the company's industry, not remote/onsite.
      mode: /\bremote\b/i.test(`${str(i.title)} ${str(i.location)}`) ? "Remote" : "",
      tier: s.location.label,
      posted: str(i.postedDate) || str(i.postedTimeAgo),
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
  dates?: { posted?: string | null; age?: string | null };
};

export async function searchIndeed(s: SearchInput): Promise<RawJob[]> {
  if (!s.location.indeedCountry) return [];
  const exclusions = s.excludeTitleWords.map((w) => `-${w}`).join(" ");
  const items = await runActor<IndeedItem>(
    "indeed",
    {
      keyword: [s.title, s.location.remote ? "remote" : "", exclusions].filter(Boolean).join(" "),
      location: s.location.indeedLocation,
      country: s.location.indeedCountry,
      maxItems: s.limit,
      sort: "date",
      fromDays: String(s.postedWithinDays),
      searchMode: "basic",
      proxyConfig: { useApifyProxy: true },
    },
    s.limit,
  );
  return items
    .filter((i) => str(i.title?.text) && str(i.company?.name))
    .map((i) => ({
      source: "Indeed",
      kind: "listing" as const,
      sourceId: str(i.id),
      company: str(i.company?.name),
      role: str(i.title?.text),
      link: str(i.urls?.indeed) || str(i.urls?.external),
      applyUrl: str(i.urls?.external) || undefined,
      location: str(i.location?.formatted),
      description: str(i.description?.text),
      pay: str(i.salary?.text ?? ""),
      mode: i.workArrangement?.isRemote ? "Remote" : str(i.workArrangement?.locationType ?? ""),
      tier: s.location.label,
      posted: str(i.dates?.posted ?? "") || str(i.dates?.age ?? ""),
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

// ---------- Glassdoor ----------

type GlassdoorItem = {
  id?: number;
  title?: string;
  url?: string;
  seoUrl?: string;
  description?: string;
  ageInDays?: number;
  employer?: { name?: string; url?: string };
  location?: { name?: string };
  pay?: { min?: number | null; max?: number | null; currency?: string; period?: string | null };
};

export async function searchGlassdoor(s: SearchInput): Promise<RawJob[]> {
  const items = await runActor<GlassdoorItem>(
    "glassdoor",
    {
      keywords: s.title,
      location: s.location.indeedLocation || s.location.linkedin || "Remote",
      daysOld: s.postedWithinDays,
      remoteWorkType: s.location.remote,
      sortBy: "date_desc",
      limit: s.limit,
    },
    s.limit,
  );
  return items
    .filter((i) => str(i.title) && str(i.employer?.name) && (str(i.url) || str(i.seoUrl)))
    .filter((i) => !excludedTitle(str(i.title), s.excludeTitleWords))
    .map((i) => ({
      source: "Glassdoor",
      kind: "listing" as const,
      sourceId: str(i.id),
      company: str(i.employer?.name),
      role: str(i.title),
      link: str(i.seoUrl) || str(i.url),
      location: str(i.location?.name),
      description: stripHtml(i.description),
      pay: payText(i.pay?.min, i.pay?.max, i.pay?.currency, i.pay?.period),
      mode: s.location.remote || saysRemote(str(i.location?.name)) ? "Remote" : "",
      tier: s.location.label,
      posted: typeof i.ageInDays === "number" ? `${i.ageInDays} days ago` : undefined,
      company_: {},
    }));
}

// ---------- Wellfound ----------

type WellfoundItem = {
  jobId?: string;
  title?: string;
  url?: string;
  applyUrl?: string;
  description?: string;
  location?: string;
  locations?: string[];
  workMode?: string;
  compensation?: string;
  postedAt?: number;
  company?: { name?: string; companySize?: string; tagline?: string; slug?: string };
};

export async function searchWellfound(s: SearchInput): Promise<RawJob[]> {
  const items = await runActor<WellfoundItem>(
    "wellfound",
    {
      keywords: s.title,
      ...(s.location.remote ? { remote: true } : { location: s.location.linkedin }),
      maxJobs: s.limit,
      maxPages: 3,
    },
    s.limit,
  );
  return items
    .filter((i) => str(i.title) && str(i.company?.name) && str(i.url))
    .filter((i) => !excludedTitle(str(i.title), s.excludeTitleWords))
    .map((i) => {
      const location = str(i.location) || (i.locations ?? []).join(" / ");
      const remote = /remote/i.test(`${str(i.workMode)} ${location}`);
      return {
        source: "Wellfound",
        kind: "listing" as const,
        sourceId: str(i.jobId) || str(i.url),
        company: str(i.company?.name),
        role: str(i.title),
        link: str(i.url),
        applyUrl: str(i.applyUrl) || undefined,
        location,
        description: stripHtml(i.description),
        pay: str(i.compensation),
        mode: remote ? "Remote" : str(i.workMode),
        tier: s.location.label,
        posted: isoDate(i.postedAt),
        company_: {
          size: str(i.company?.companySize),
          about: str(i.company?.tagline),
          website: i.company?.slug ? `https://wellfound.com/company/${i.company.slug}` : undefined,
        },
      };
    });
}

// ---------- Google (company career boards) ----------

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
  const sub = host.split(".")[0];
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
  } else if (host.endsWith("myworkdayjobs.com")) {
    if (!parts.includes("job")) return null;
    company = pretty(sub);
    role = firstPart(t);
  } else if (host === "jobs.smartrecruiters.com") {
    if (parts.length < 2) return null;
    company = pretty(parts[0]);
    role = firstPart(t.replace(new RegExp(`^${parts[0]}\\s+`, "i"), ""));
  } else if (/\.(recruitee\.com|teamtailor\.com|bamboohr\.com|breezy\.hr)$/.test(host) || /\.jobs\.personio\.(de|com)$/.test(host)) {
    if (parts.length < 2) return null;
    company = pretty(sub);
    role = firstPart(t);
  } else if (host === "wellfound.com") {
    if (parts[0] !== "jobs" || parts.length < 2) return null;
    const m = t.match(/^(.+?)\s+at\s+(.+?)(?:\s+[•|].*)?$/i);
    role = m?.[1] ?? firstPart(t);
    company = m?.[2] ?? "";
    if (!company) return null;
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
  opts: { remoteOnly: boolean; postedWithinDays: PostedWithin; tier: string; excludeTitleWords: string[] },
): Promise<RawJob[]> {
  if (!titles.length) return [];
  const queries = titles.flatMap((t) =>
    BOARDS.map((board) => `"${t}" ${opts.remoteOnly ? "remote " : ""}site:${board}`),
  );
  // Google only knows when it indexed a page, not when the job was posted.
  const tbs = opts.postedWithinDays === 1 ? "qdr:d" : opts.postedWithinDays === 3 ? "qdr:d3" : "qdr:w";
  const rows = await runActor<SerpRow>(
    "google",
    { keyword: queries.join("\n"), limit: "10", include_merged: false, tbs, hl: "en" },
    queries.length,
    (r) => r.length,
  );

  const jobs: RawJob[] = [];
  for (const row of rows) {
    for (const r of row.results ?? []) {
      const parsed = parseBoardResult(str(r.url), str(r.title));
      if (!parsed) continue;
      if (excludedTitle(parsed.role, opts.excludeTitleWords)) continue;
      const snippet = str(r.description);
      // Only say remote when the page does; the location filter judges the rest.
      const remote = saysRemote(`${parsed.role} ${snippet}`);
      jobs.push({
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
      });
    }
  }
  return jobs;
}

// ---------- hiring posts on LinkedIn, X and Reddit ----------

type LinkedInPost = {
  id?: string;
  content?: string | null;
  linkedinUrl?: string;
  author?: { name?: string; linkedinUrl?: string; info?: string; type?: string };
  postedAt?: { date?: string; timestamp?: number };
  job?: { title?: string; subtitle?: string; location?: string; linkedinUrl?: string };
};

export function mapLinkedInPosts(items: LinkedInPost[]): Post[] {
  return items
    .filter((i) => str(i.content) && str(i.linkedinUrl))
    .map((i) => {
      const headline = str(i.author?.info);
      return {
        source: "LinkedIn post",
        id: str(i.id) || str(i.linkedinUrl),
        title: str(i.job?.title) || undefined,
        text: [str(i.content), i.job ? `Job: ${str(i.job.title)} · ${str(i.job.subtitle)} · ${str(i.job.location)}` : ""].filter(Boolean).join("\n\n"),
        link: str(i.linkedinUrl),
        author: str(i.author?.name),
        authorUrl: str(i.author?.linkedinUrl),
        company:
          i.author?.type === "company"
            ? str(i.author?.name)
            : str(i.job?.subtitle) || headline.match(/\b(?:at|@)\s+([^|,·•]+)/i)?.[1]?.trim() || "",
        posted: str(i.postedAt?.date) || isoDate(i.postedAt?.timestamp),
      };
    });
}

export async function searchLinkedInPosts(ctx: SourceContext): Promise<RawJob[]> {
  const queries = ctx.boardTitles.map((t) => `hiring "${t}"`);
  const items = await runActor<LinkedInPost>(
    "linkedinPosts",
    { searchQueries: queries, maxPosts: ctx.apifyLimit, postedLimit: ctx.postedWithinDays === 1 ? "24h" : "week", sortBy: "date" },
    queries.length * ctx.apifyLimit,
  );
  return mapLinkedInPosts(items).map((p) => postToJob(p, ctx)).filter((j): j is RawJob => !!j);
}

type Tweet = {
  id?: string;
  url?: string;
  twitterUrl?: string;
  text?: string;
  fullText?: string;
  createdAt?: string;
  isRetweet?: boolean;
  author?: { userName?: string; name?: string; url?: string; description?: string };
};

export function mapTweets(items: Tweet[]): Post[] {
  return items
    .filter((t) => !t.isRetweet && (str(t.fullText) || str(t.text)) && (str(t.url) || str(t.twitterUrl)))
    .map((t) => ({
      source: "X post",
      id: str(t.id),
      text: str(t.fullText) || str(t.text),
      link: str(t.url) || str(t.twitterUrl),
      author: t.author?.userName ? `@${t.author.userName}` : str(t.author?.name),
      authorUrl: str(t.author?.url),
      posted: isoDate(t.createdAt),
    }));
}

export async function searchXPosts(ctx: SourceContext): Promise<RawJob[]> {
  const since = new Date(Date.now() - ctx.postedWithinDays * 864e5).toISOString().slice(0, 10);
  const terms = ctx.boardTitles.map((t) => `"${t}" (hiring OR "we're hiring" OR "join our team") -is:retweet since:${since}`);
  const items = await runActor<Tweet>(
    "xPosts",
    { searchTerms: terms, maxItems: terms.length * ctx.apifyLimit, sort: "Latest", tweetLanguage: "en" },
    terms.length * ctx.apifyLimit,
  );
  return mapTweets(items).map((p) => postToJob(p, ctx)).filter((j): j is RawJob => !!j);
}

type RedditItem = {
  id?: string;
  type?: string;
  title?: string;
  selfText?: string;
  body?: string;
  url?: string;
  permalink?: string;
  author?: string;
  createdAt?: string;
  subreddit?: string;
  linkFlairText?: string;
};

export function mapRedditApify(items: RedditItem[]): Post[] {
  return items
    .filter((i) => i.type !== "comment" && str(i.title))
    .map((i) => ({
      source: "Reddit",
      id: str(i.id),
      title: `${i.linkFlairText && !/hiring/i.test(str(i.title)) ? `[${i.linkFlairText}] ` : ""}${str(i.title)}`,
      text: str(i.selfText) || str(i.body),
      link: !str(i.permalink) ? str(i.url) : str(i.permalink).startsWith("http") ? str(i.permalink) : `https://www.reddit.com${str(i.permalink)}`,
      author: i.author ? `u/${i.author}` : "",
      posted: isoDate(i.createdAt),
    }));
}

export async function searchRedditApify(ctx: SourceContext): Promise<RawJob[]> {
  const queries = ctx.boardTitles.map((t) => `hiring ${t}`);
  const items = await runActor<RedditItem>(
    "reddit",
    {
      searchQueries: queries,
      sort: "new",
      timeFilter: ctx.postedWithinDays === 1 ? "day" : "week",
      maxPostsPerSource: ctx.apifyLimit,
      includeComments: false,
    },
    queries.length * ctx.apifyLimit,
  );
  return mapRedditApify(items).map((p) => postToJob(p, ctx)).filter((j): j is RawJob => !!j);
}

// ---------- Craigslist ----------

type CraigslistItem = {
  postId?: string | null;
  title?: string;
  url?: string;
  description?: string;
  location?: string;
  region?: string;
  postedAt?: string | null;
  categorySlug?: string;
  attributes?: { compensation?: string };
};

/** Craigslist sections searched: software jobs and computer gigs. */
export const CRAIGSLIST_SECTIONS = { sof: "listing", cpg: "post" } as const;

/** Search pages for each city and section. Titles are OR'd: "a"|"b". */
export function craigslistUrls(cities: string[], titles: string[], remoteOnly: boolean): string[] {
  const query = titles.map((t) => `"${t.replace(/"/g, "")}"`).join("|");
  return cities
    .map((c) => c.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.craigslist\.org.*$/, ""))
    .filter((c) => /^[a-z0-9-]+$/.test(c))
    .flatMap((city) =>
      Object.keys(CRAIGSLIST_SECTIONS).map((section) => {
        const params = new URLSearchParams({ query, sort: "date" });
        // Gigs have no telecommute filter; posts are checked for "remote" when kept.
        if (remoteOnly && section === "sof") params.set("is_telecommuting", "1");
        return `https://${city}.craigslist.org/search/${section}?${params}`;
      }),
    );
}

export function mapCraigslist(items: CraigslistItem[], tier: string): RawJob[] {
  return items.flatMap((i) => {
    const role = str(i.title);
    const link = str(i.url);
    if (!role || !link) return [];
    const description = str(i.description);
    const gig = /\/cpg\/|computer gigs?/i.test(`${link} ${str(i.categorySlug)}`);
    const region = str(i.region) || (link.match(/\/\/([a-z0-9-]+)\.craigslist/)?.[1] ?? "");
    return [{
      source: "Craigslist",
      kind: gig ? ("post" as const) : ("listing" as const),
      sourceId: `craigslist:${str(i.postId) || link}`,
      company: companyFromText(description) || `Craigslist poster (${region || "unknown city"})`,
      role,
      link,
      location: str(i.location) || region,
      description: truncate(description, 6000),
      pay: str(i.attributes?.compensation),
      mode: saysRemote(`${role} ${description}`) ? "Remote" : "",
      tier,
      posted: isoDate(i.postedAt),
      company_: {},
    }];
  });
}

export async function searchCraigslist(ctx: SourceContext, titles: string[], cities: string[]): Promise<RawJob[]> {
  const remote = ctx.locations.find((l) => l.remote);
  const startUrls = craigslistUrls(cities, titles, !!remote);
  if (!startUrls.length) throw new Error("Add at least one Craigslist city in Settings → Where to look.");
  const max = ctx.apifyLimit * startUrls.length;
  const items = await runActor<CraigslistItem>(
    "craigslist",
    { startUrls: startUrls.map((url) => ({ url })), postedToday: ctx.postedWithinDays === 1, includeDetails: true, sort: "date", maxResults: max },
    max,
  );
  const tier = remote?.label ?? ctx.locations[0]?.label ?? "";
  return mapCraigslist(items, tier).filter(
    (j) => matchesTitle(j.role, ctx.titles, ctx.excludeTitleWords) && (j.kind === "listing" || !remote || j.mode === "Remote"),
  );
}
