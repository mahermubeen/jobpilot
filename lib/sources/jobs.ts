import type { SearchLocation } from "@/lib/settings";
import { runActor } from "./apify";
import { excludedTitle } from "./match";
import { isoDate, payText, saysRemote, str, stripHtml } from "./net";
import type { PostedWithin } from "./posted";
import type { RawJob } from "./types";

/**
 * Paid job sources, each run through an Apify actor (see actors.ts for ids and prices).
 * Google boards, social posts and Craigslist live in their own files and are re-exported here.
 */
export { BOARDS, parseBoardResult, searchGoogle } from "./google-boards";
export { mapLinkedInPosts, mapRedditApify, mapTweets, searchLinkedInPosts, searchRedditApify, searchXPosts } from "./posts";
export { CRAIGSLIST_SECTIONS, craigslistUrls, mapCraigslist, searchCraigslist } from "./craigslist";

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
    .map((i) => indeedToJob(i, s.location.label))
    .filter((j) => j.link);
}

function indeedCompany(c: IndeedItem["company"] = {}): RawJob["company_"] {
  return {
    website: str(c.urls?.website),
    size: str(c.size),
    industry: str(c.industry),
    about: str(c.briefDescription),
    address: str(c.addresses?.[0]),
  };
}

const indeedMode = (w: IndeedItem["workArrangement"] = {}) => (w.isRemote ? "Remote" : str(w.locationType));

/** The text fields Indeed nests one level down. */
const indeedText = (i: IndeedItem) => ({
  company: str(i.company?.name),
  role: str(i.title?.text),
  location: str(i.location?.formatted),
  description: str(i.description?.text),
  pay: str(i.salary?.text),
  posted: str(i.dates?.posted) || str(i.dates?.age),
});

function indeedToJob(i: IndeedItem, tier: string): RawJob {
  const urls = i.urls ?? {};
  return {
    ...indeedText(i),
    source: "Indeed",
    kind: "listing",
    sourceId: str(i.id),
    link: str(urls.indeed) || str(urls.external),
    applyUrl: str(urls.external) || undefined,
    mode: indeedMode(i.workArrangement),
    tier,
    company_: indeedCompany(i.company),
  };
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
    .map((i) => glassdoorToJob(i, s.location));
}

function glassdoorToJob(i: GlassdoorItem, loc: SearchLocation): RawJob {
  const location = str(i.location?.name);
  const pay = i.pay ?? {};
  return {
    source: "Glassdoor",
    kind: "listing",
    sourceId: str(i.id),
    company: str(i.employer?.name),
    role: str(i.title),
    link: str(i.seoUrl) || str(i.url),
    location,
    description: stripHtml(i.description),
    pay: payText(pay.min, pay.max, pay.currency, pay.period),
    mode: loc.remote || saysRemote(location) ? "Remote" : "",
    tier: loc.label,
    posted: typeof i.ageInDays === "number" ? `${i.ageInDays} days ago` : undefined,
    company_: {},
  };
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
    .map((i) => wellfoundToJob(i, s.location.label));
}

function wellfoundCompany(c: WellfoundItem["company"] = {}): RawJob["company_"] {
  return {
    size: str(c.companySize),
    about: str(c.tagline),
    website: c.slug ? `https://wellfound.com/company/${c.slug}` : undefined,
  };
}

function wellfoundToJob(i: WellfoundItem, tier: string): RawJob {
  const location = str(i.location) || (i.locations ?? []).join(" / ");
  const remote = /remote/i.test(`${str(i.workMode)} ${location}`);
  return {
    source: "Wellfound",
    kind: "listing",
    sourceId: str(i.jobId) || str(i.url),
    company: str(i.company?.name),
    role: str(i.title),
    link: str(i.url),
    applyUrl: str(i.applyUrl) || undefined,
    location,
    description: stripHtml(i.description),
    pay: str(i.compensation),
    mode: remote ? "Remote" : str(i.workMode),
    tier,
    posted: isoDate(i.postedAt),
    company_: wellfoundCompany(i.company),
  };
}
