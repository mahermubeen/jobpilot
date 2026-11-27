import { truncate } from "@/lib/util";
import { excludedTitle, matchingTitle } from "./match";
import { fetchJson, isoDate, pool, saysRemote, type SourceContext, SourceHttpError, str, stripHtml } from "./net";
import type { RawJob } from "./types";

/**
 * Social posts announcing jobs. They rarely name the role the way a job
 * board would, so the matched search title stands in as the role and the
 * post itself is kept as the description for you to read and act on.
 */

export type Post = {
  source: string;
  id: string;
  text: string;
  link: string;
  author: string;
  authorUrl?: string;
  /** The company, when the post or its author says it. */
  company?: string;
  posted?: string;
  /** A short first line, when the platform has a title. */
  title?: string;
};

const HIRING = /\b(hiring|we'?re hiring|is hiring|are hiring|looking for|seeking|join (?:our|my|the) team|open (?:role|position)|job opening|vacanc(?:y|ies))\b/i;
const NOT_HIRING = /\[(for hire|for-hire)\]|\b(open to work|looking for (?:a )?(?:job|work|opportunit)|hire me|available for (?:work|hire))\b/i;

/** Picks a company name out of a post: "at Acme", "@Acme", "Acme is hiring". */
export function companyFromText(text: string): string {
  const first = text.split("\n")[0];
  const m =
    first.match(/^([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,3}) (?:is|are) hiring\b/) ??
    first.match(/\b(?:at|@|join)\s+([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,3})/);
  return m?.[1]?.replace(/[.,!:]+$/, "") ?? "";
}

/** A post becomes a job when it is hiring (not someone looking for work) and mentions a search title. */
export function postToJob(p: Post, ctx: Pick<SourceContext, "titles" | "excludeTitleWords" | "locations">): RawJob | null {
  const text = `${p.title ?? ""}\n${p.text}`.trim();
  if (!text || NOT_HIRING.test(text) || !HIRING.test(text)) return null;
  const title = matchingTitle(p.title || text, ctx.titles) ?? matchingTitle(text, ctx.titles);
  if (!title || excludedTitle(p.title || text.split("\n")[0], ctx.excludeTitleWords)) return null;
  const remote = saysRemote(text);
  return {
    source: p.source,
    kind: "post",
    sourceId: p.id,
    company: p.company || companyFromText(text) || p.author,
    role: title,
    link: p.link,
    location: remote ? "Remote" : "",
    description: truncate(text, 4000),
    pay: "",
    mode: remote ? "Remote" : "",
    tier: (remote ? ctx.locations.find((l) => l.remote)?.label : ctx.locations[0]?.label) ?? "",
    posted: p.posted,
    company_: {},
    recruiter: p.author ? { name: p.author, linkedin: p.authorUrl?.includes("linkedin.com") ? p.authorUrl : undefined } : undefined,
  };
}

// ---------- Hacker News "Who is hiring" ----------

type HnHit = { objectID: string; title?: string; created_at?: string; comment_text?: string; parent_id?: number; story_id?: number; author?: string };

/**
 * One top-level comment per company, by convention starting with a line like
 * "Acme | Senior Engineer | Remote (EU) | $150k".
 */
export function parseHnComment(hit: HnHit, ctx: Pick<SourceContext, "titles" | "excludeTitleWords" | "locations">): RawJob | null {
  const text = stripHtml(hit.comment_text);
  if (!text) return null;
  const head = text.split("\n")[0];
  const parts = head.split(/\s+\|\s+|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const title = matchingTitle(head, ctx.titles) ?? matchingTitle(text, ctx.titles);
  if (!title || excludedTitle(head, ctx.excludeTitleWords)) return null;
  const role = parts.find((p) => matchingTitle(p, ctx.titles)) ?? title;
  const short = parts.filter((p) => p.length <= 60);
  const place = short.find((p) => /\b(remote|onsite|on-site|hybrid)\b/i.test(p)) ?? short.slice(1).find((p) => /,/.test(p)) ?? "";
  const pay = short.find((p) => /[$€£]\s?\d|\d+\s?k\b/i.test(p)) ?? "";
  const remote = /\bremote\b/i.test(place);
  return {
    source: "HN Who is hiring",
    kind: "post",
    sourceId: hit.objectID,
    company: parts[0].replace(/\s*\(.*?\)\s*$/, "").slice(0, 80),
    role: role.slice(0, 120),
    link: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    location: place,
    description: truncate(text, 6000),
    pay,
    mode: remote ? "Remote" : /hybrid/i.test(place) ? "Hybrid" : /onsite|on-site/i.test(place) ? "Onsite" : "",
    tier: (remote ? ctx.locations.find((l) => l.remote)?.label : ctx.locations[0]?.label) ?? "",
    // The thread runs all month; every comment counts as current, and repeats are dropped when saving.
    company_: {},
    recruiter: hit.author ? { name: `${hit.author} (HN)` } : undefined,
  };
}

const HN = "https://hn.algolia.com/api/v1";

export async function searchHackerNews(ctx: SourceContext): Promise<RawJob[]> {
  const stories = await fetchJson<{ hits: HnHit[] }>(`${HN}/search_by_date?tags=story,author_whoishiring&hitsPerPage=6`);
  const thread = stories.hits.find((h) => /who is hiring/i.test(h.title ?? ""));
  if (!thread) return [];
  const jobs: RawJob[] = [];
  for (let page = 0; page < 5; page++) {
    const res = await fetchJson<{ hits: HnHit[]; nbPages: number }>(
      `${HN}/search?tags=comment,story_${thread.objectID}&hitsPerPage=1000&page=${page}`,
    );
    for (const hit of res.hits) {
      if (String(hit.parent_id) !== thread.objectID) continue;
      const job = parseHnComment(hit, ctx);
      if (job) jobs.push(job);
    }
    if (page + 1 >= res.nbPages) break;
  }
  ctx.log(`HN: read “${thread.title}”`);
  return jobs;
}

// ---------- Reddit (free, without a login) ----------

const SUBREDDITS = ["forhire", "hiring", "remotejs", "RemoteJobs", "jobbit", "webdevjobs", "devopsjobs", "jobsforall", "remotework"];

type RedditListing = {
  data?: { children?: { data?: { id?: string; title?: string; selftext?: string; permalink?: string; author?: string; created_utc?: number; subreddit?: string; link_flair_text?: string } }[] };
};

export function mapReddit(listing: RedditListing): Post[] {
  return (listing.data?.children ?? []).flatMap(({ data: d }) =>
    d?.id
      ? [{
          source: "Reddit",
          id: d.id,
          title: `${d.link_flair_text && !/hiring/i.test(d.title ?? "") ? `[${d.link_flair_text}] ` : ""}${str(d.title)}`,
          text: str(d.selftext),
          link: `https://www.reddit.com${str(d.permalink)}`,
          author: d.author ? `u/${d.author}` : "",
          posted: isoDate(d.created_utc),
        }]
      : [],
  );
}

export async function searchReddit(ctx: SourceContext): Promise<RawJob[]> {
  // One listing for all the subreddits, then a title search across them.
  const subs = SUBREDDITS.join("+");
  const urls = [
    `https://www.reddit.com/r/${subs}/new.json?limit=100`,
    ...ctx.boardTitles.map((t) => `https://www.reddit.com/r/${subs}/search.json?q=${encodeURIComponent(t)}&restrict_sr=1&sort=new&t=week&limit=50`),
  ];
  let blocked = false;
  const posts = await pool(urls, 2, async (url) => {
    if (blocked) return [];
    try {
      return mapReddit(await fetchJson<RedditListing>(url));
    } catch (err) {
      if (err instanceof SourceHttpError && (err.status === 403 || err.status === 429)) {
        blocked = true;
        return [];
      }
      throw err;
    }
  });
  const flat = posts.flat();
  if (blocked && !flat.length) {
    throw new Error("Reddit refused the request (it blocks most apps without a login). Turn on “Reddit (Apify)” in Settings to search it through Apify.");
  }
  return flat.map((p) => postToJob(p, ctx)).filter((j): j is RawJob => !!j);
}
