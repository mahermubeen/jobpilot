import { domainOf } from "@/lib/util";
import { runActor } from "./apify";
import type { SiteContacts } from "./types";

const PAGES_PER_SITE = 5;

type ContactRow = {
  domain?: string;
  originalStartUrl?: string;
  emails?: string[];
  phones?: string[];
  phonesUncertain?: string[];
  linkedIns?: string[];
};

/** Crawls a few pages of each company site for public emails and phone numbers. */
export async function scrapeSites(websites: string[]): Promise<Map<string, SiteContacts>> {
  const out = new Map<string, SiteContacts>();
  const urls = [...new Set(websites.map((w) => domainOf(w)).filter((d): d is string => !!d))];
  if (!urls.length) return out;

  const rows = await runActor<ContactRow>(
    "contacts",
    {
      startUrls: urls.map((d) => ({ url: `https://${d}` })),
      maxRequestsPerStartUrl: PAGES_PER_SITE,
      maxRequests: urls.length * PAGES_PER_SITE,
      maxDepth: 1,
      sameDomain: true,
      mergeContacts: true,
      considerChildFrames: false,
      proxyConfig: { useApifyProxy: true },
    },
    urls.length * PAGES_PER_SITE,
    // Billing is per page crawled; assume the cap was used for each site that answered.
    (r) => r.length * PAGES_PER_SITE,
  );

  for (const row of rows) {
    const domain = domainOf(row.originalStartUrl) ?? domainOf(row.domain);
    if (!domain) continue;
    const prev = out.get(domain) ?? { domain, emails: [], phones: [], linkedIns: [] };
    out.set(domain, {
      domain,
      emails: [...new Set([...prev.emails, ...(row.emails ?? [])].map((e) => e.toLowerCase()))],
      phones: [...new Set([...prev.phones, ...(row.phones ?? [])])],
      linkedIns: [...new Set([...prev.linkedIns, ...(row.linkedIns ?? [])])],
    });
  }
  return out;
}

const JUNK = /(no-?reply|donotreply|privacy|legal|abuse|postmaster|webmaster|sentry|wixpress|example\.|unsubscribe|billing|invoice|press@|media@|security@|dpo@|gdpr)/i;
const FILE = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;
const HIRING = /^(careers?|jobs?|hiring|recruit(ing|ment|er)?|talent|hr|people|join|work)@/i;
const GENERIC = /^(info|hello|hi|contact|team|office|admin|support|help|sales|enquir(y|ies)|inquir(y|ies)|mail)@/i;

export type RankedEmail = {
  email: string;
  kind: "hiring" | "person" | "generic";
};

/**
 * Orders scraped emails by how useful they are for a job application:
 * hiring inboxes first, then named people, then generic inboxes. Addresses on
 * other domains, no-reply inboxes and image filenames are dropped.
 */
export function rankEmails(emails: string[], companyDomain: string | null): RankedEmail[] {
  const seen = new Set<string>();
  const ranked: RankedEmail[] = [];
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) continue;
    if (seen.has(email) || JUNK.test(email) || FILE.test(email)) continue;
    const domain = email.split("@")[1];
    if (companyDomain && !(domain === companyDomain || domain.endsWith(`.${companyDomain}`))) {
      continue;
    }
    seen.add(email);
    ranked.push({
      email,
      kind: HIRING.test(email) ? "hiring" : GENERIC.test(email) ? "generic" : "person",
    });
  }
  const order = { hiring: 0, person: 1, generic: 2 };
  return ranked.sort((a, b) => order[a.kind] - order[b.kind]);
}

const NOT_A_COMPANY_SITE =
  /(linkedin|facebook|instagram|twitter|x\.com|youtube|tiktok|crunchbase|glassdoor|indeed|wikipedia|greenhouse|lever\.co|ashbyhq|workable|wellfound|angel\.co|github|medium|bloomberg|zoominfo|rocketreach|apollo\.io|pitchbook|g2\.com|trustpilot|yelp|google\.|remotive|jooble|jobrapido|jobleads)/i;

const WORD_NOISE = new Set(["the", "inc", "llc", "ltd", "limited", "corp", "company", "group", "labs", "technologies", "solutions", "systems", "global"]);

/**
 * Picks the company's own site from search results: the first result that is
 * not a directory or job board and whose domain contains a distinctive word
 * of the company name. Returns null rather than guess.
 */
export function pickWebsite(companyName: string, urls: string[]): string | null {
  const words = companyName
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !WORD_NOISE.has(w));
  const compact = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const url of urls) {
    const domain = domainOf(url);
    if (!domain || NOT_A_COMPANY_SITE.test(domain)) continue;
    const label = domain.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
    if (!label) continue;
    if (words.some((w) => label.includes(w)) || (label.length >= 4 && compact.includes(label))) {
      return `https://${domain}`;
    }
  }
  return null;
}

type SerpRow = { search_term?: string; results?: { url?: string }[] };

/** Finds the official website for companies we only know by name. */
export async function findWebsites(companyNames: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const names = [...new Set(companyNames.filter(Boolean))];
  if (!names.length) return out;
  const queries = names.map((n) => `${n} company official website`);
  const rows = await runActor<SerpRow>(
    "google",
    { keyword: queries.join("\n"), limit: "10", include_merged: false, hl: "en" },
    queries.length,
    (r) => r.length,
  );
  for (const row of rows) {
    const i = queries.indexOf(String(row.search_term ?? ""));
    if (i === -1) continue;
    const site = pickWebsite(names[i], (row.results ?? []).map((r) => String(r.url ?? "")));
    if (site) out.set(names[i], site);
  }
  return out;
}
