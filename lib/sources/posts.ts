import { runActor } from "./apify";
import { isoDate, type SourceContext, str } from "./net";
import { type Post, postToJob } from "./social";
import type { RawJob } from "./types";

/** Hiring posts on LinkedIn, X and Reddit, read through Apify actors. */

type LinkedInPost = {
  id?: string;
  content?: string | null;
  linkedinUrl?: string;
  author?: { name?: string; linkedinUrl?: string; info?: string; type?: string };
  postedAt?: { date?: string; timestamp?: number };
  job?: { title?: string; subtitle?: string; location?: string; linkedinUrl?: string };
};

/** The hiring company: the author when it is a company page, else the attached job or the author's headline. */
function linkedInPostCompany(i: LinkedInPost): string {
  if (i.author?.type === "company") return str(i.author.name);
  const fromHeadline = str(i.author?.info).match(/\b(?:at|@)\s+([^|,·•]+)/i)?.[1]?.trim();
  return str(i.job?.subtitle) || fromHeadline || "";
}

const attachedJob = (job: LinkedInPost["job"]) => (job ? `Job: ${str(job.title)} · ${str(job.subtitle)} · ${str(job.location)}` : "");

function linkedInPostToPost(i: LinkedInPost): Post {
  return {
    source: "LinkedIn post",
    id: str(i.id) || str(i.linkedinUrl),
    title: str(i.job?.title) || undefined,
    text: [str(i.content), attachedJob(i.job)].filter(Boolean).join("\n\n"),
    link: str(i.linkedinUrl),
    author: str(i.author?.name),
    authorUrl: str(i.author?.linkedinUrl),
    company: linkedInPostCompany(i),
    posted: str(i.postedAt?.date) || isoDate(i.postedAt?.timestamp),
  };
}

export function mapLinkedInPosts(items: LinkedInPost[]): Post[] {
  return items.filter((i) => str(i.content) && str(i.linkedinUrl)).map(linkedInPostToPost);
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

function redditLink(i: RedditItem): string {
  const permalink = str(i.permalink);
  if (!permalink) return str(i.url);
  return permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`;
}

export function mapRedditApify(items: RedditItem[]): Post[] {
  return items
    .filter((i) => i.type !== "comment" && str(i.title))
    .map((i) => ({
      source: "Reddit",
      id: str(i.id),
      title: `${i.linkFlairText && !/hiring/i.test(str(i.title)) ? `[${i.linkFlairText}] ` : ""}${str(i.title)}`,
      text: str(i.selfText) || str(i.body),
      link: redditLink(i),
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
