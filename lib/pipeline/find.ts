import { getDb, schema } from "@/lib/db";
import type { AppSettings, Secrets, SearchLocation } from "@/lib/settings";
import { BudgetError } from "@/lib/sources/apify";
import { rememberBoards, searchCareerPages } from "@/lib/sources/ats";
import {
  searchArbeitnow,
  searchHimalayas,
  searchJobicy,
  searchRemoteOk,
  searchRemotive,
  searchWeWorkRemotely,
} from "@/lib/sources/feeds";
import { type BoardKeys, searchAdzuna, searchJooble, searchReed } from "@/lib/sources/keyed";
import {
  type SearchInput,
  searchCraigslist,
  searchGlassdoor,
  searchGoogle,
  searchIndeed,
  searchLinkedIn,
  searchLinkedInPosts,
  searchRedditApify,
  searchWellfound,
  searchXPosts,
} from "@/lib/sources/jobs";
import { JOBSPY_SITES, type JobSpySite, SITE_LABEL, searchJobSpy } from "@/lib/sources/jobspy";
import { searchTitles } from "@/lib/sources/match";
import { pool, type SourceContext } from "@/lib/sources/net";
import { postedTooLongAgo, postedWithinLabel, type PostedWithin } from "@/lib/sources/posted";
import { searchHackerNews, searchReddit } from "@/lib/sources/social";
import type { RawJob } from "@/lib/sources/types";
import { errorMessage } from "@/lib/util";

export type Log = (line: string) => void;

type SearchTask = {
  label: string;
  cost: "free" | "apify";
  timeoutMs: number;
  run: () => Promise<RawJob[]>;
};

type Search = AppSettings["search"];
type Keys = BoardKeys & Pick<Secrets, "apifyToken">;
/** What every task builder needs. */
type Plan = { search: Search; ctx: SourceContext; apifyTitles: string[]; postedWithinDays: PostedWithin; on: (key: string) => boolean };

const MIN = 60_000;
const PAID_TIMEOUT = 11 * MIN;
const PARALLEL_SEARCHES = 4;

const withTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} took longer than ${Math.round(ms / 60_000)} minutes; skipped.`)), ms),
    ),
  ]);

/**
 * Searches that cost time or money per title use your own titles, topped up
 * with the first variants only while the list is short.
 */
function splitTitles(search: Search) {
  const titles = searchTitles(search);
  const own = titles.filter((t) => search.titles.some((o) => o.trim() === t));
  const extra = titles.filter((t) => !own.includes(t));
  const ordered = [...own, ...extra];
  return {
    titles,
    own,
    extra,
    boardTitles: ordered.slice(0, Math.max(own.length, 8)),
    apifyTitles: ordered.slice(0, Math.max(own.length, 4)),
  };
}

/** Free job boards, scraped together by one JobSpy process. */
function jobSpyTasks({ ctx, on }: Plan): SearchTask[] {
  const sites = JOBSPY_SITES.filter((s) => on(`jobspy-${s}`));
  if (!sites.length) return [];
  const logSite = (site: JobSpySite, found: number, errs: string[]) =>
    ctx.log(`${SITE_LABEL[site]}: ${found} jobs${errs.length ? ` (${errs.length} searches failed: ${errs[0]})` : ""}`);
  return [
    {
      label: "JobSpy",
      cost: "free",
      // JobSpy keeps what it found when its own 15-minute budget runs out.
      timeoutMs: 20 * MIN,
      run: async () => {
        const { jobs, errors } = await searchJobSpy(ctx, sites, 15 * MIN);
        for (const site of sites) logSite(site, jobs[site]?.length ?? 0, errors[site] ?? []);
        return sites.flatMap((s) => jobs[s] ?? []);
      },
    },
  ];
}

const FREE_FEEDS: [string, string, (c: SourceContext) => Promise<RawJob[]>][] = [
  ["remoteok", "Remote OK", searchRemoteOk],
  ["remotive", "Remotive", searchRemotive],
  ["weworkremotely", "We Work Remotely", searchWeWorkRemotely],
  ["himalayas", "Himalayas", searchHimalayas],
  ["jobicy", "Jobicy", searchJobicy],
  ["arbeitnow", "Arbeitnow", searchArbeitnow],
  ["hn", "Hacker News", searchHackerNews],
  ["reddit", "Reddit", searchReddit],
];

function freeFeedTasks({ ctx, on }: Plan): SearchTask[] {
  return FREE_FEEDS.filter(([key]) => on(key)).map(([, label, fn]) => ({ label, cost: "free", timeoutMs: 3 * MIN, run: () => fn(ctx) }));
}

/** Free official APIs that need a key; without one they are skipped with a note. */
function keyedTasks({ ctx, on, search }: Plan, keys: Keys): SearchTask[] {
  const keyed: [string, string, boolean, () => Promise<RawJob[]>][] = [
    ["adzuna", "Adzuna", !!(keys.adzunaAppId && keys.adzunaKey), () => searchAdzuna(ctx, keys, search.remoteCountries)],
    ["reed", "Reed", !!keys.reedKey, () => searchReed(ctx, keys)],
    ["jooble", "Jooble", !!keys.joobleKey, () => searchJooble(ctx, keys)],
  ];
  const wanted = keyed.filter(([key]) => on(key));
  const noKey = wanted.filter(([, , hasKey]) => !hasKey).map(([, label]) => label);
  if (noKey.length) ctx.log(`Skipped ${noKey.join(", ")}: add the free key${noKey.length > 1 ? "s" : ""} in Settings → Keys.`);
  return wanted.filter(([, , hasKey]) => hasKey).map(([, label, , run]) => ({ label, cost: "free", timeoutMs: 8 * MIN, run }));
}

const PAID_BOARDS: [string, string, (s: SearchInput) => Promise<RawJob[]>, (l: SearchLocation) => boolean][] = [
  ["linkedin", "LinkedIn (Apify)", searchLinkedIn, (l) => !!l.linkedin],
  ["indeed", "Indeed (Apify)", searchIndeed, (l) => !!l.indeedCountry],
  ["glassdoor", "Glassdoor (Apify)", searchGlassdoor, () => true],
  ["wellfound", "Wellfound (Apify)", searchWellfound, () => true],
];

/** Paid boards: one Apify run per board × location it covers × title. */
function paidBoardTasks({ search, apifyTitles, postedWithinDays, on }: Plan): SearchTask[] {
  const base = { postedWithinDays, limit: search.maxPerSearch, excludeTitleWords: search.excludeTitleWords };
  return PAID_BOARDS.filter(([key]) => on(key)).flatMap(([, label, fn, covers]) =>
    search.locations.filter(covers).flatMap((location) =>
      apifyTitles.map((title): SearchTask => ({
        label: `${label} "${title}" in ${location.label}`,
        cost: "apify",
        timeoutMs: PAID_TIMEOUT,
        run: () => fn({ ...base, title, location }),
      })),
    ),
  );
}

function googleTasks({ search, apifyTitles, postedWithinDays, on }: Plan): SearchTask[] {
  if (!on("google") || !apifyTitles.length) return [];
  const remote = search.locations.find((l) => l.remote);
  const opts = {
    remoteOnly: !!remote,
    postedWithinDays,
    tier: remote?.label ?? search.locations[0]?.label ?? "",
    excludeTitleWords: search.excludeTitleWords,
  };
  return [{ label: "Google career boards (Apify)", cost: "apify", timeoutMs: PAID_TIMEOUT, run: () => searchGoogle(apifyTitles, opts) }];
}

const PAID_POSTS: [string, string, (c: SourceContext) => Promise<RawJob[]>][] = [
  ["linkedin-posts", "LinkedIn hiring posts (Apify)", searchLinkedInPosts],
  ["x-posts", "X hiring posts (Apify)", searchXPosts],
  ["reddit-apify", "Reddit (Apify)", searchRedditApify],
];

function paidPostTasks({ ctx, search, apifyTitles, on }: Plan): SearchTask[] {
  const posts = PAID_POSTS.filter(([key]) => on(key)).map(
    ([, label, fn]): SearchTask => ({ label, cost: "apify", timeoutMs: PAID_TIMEOUT, run: () => fn(ctx) }),
  );
  if (!on("craigslist") || !apifyTitles.length) return posts;
  return [
    ...posts,
    { label: "Craigslist (Apify)", cost: "apify", timeoutMs: PAID_TIMEOUT, run: () => searchCraigslist(ctx, apifyTitles, search.craigslistCities) },
  ];
}

/** Every task switched on in Settings, JobSpy first because it is the slowest. */
function buildTasks(plan: Plan, keys: Keys): SearchTask[] {
  const tasks = [
    ...jobSpyTasks(plan),
    ...freeFeedTasks(plan),
    ...keyedTasks(plan, keys),
    ...paidBoardTasks(plan),
    ...googleTasks(plan),
    ...paidPostTasks(plan),
  ];
  // Paid sources need the Apify token; without it the free ones still run.
  if (keys.apifyToken || !tasks.some((t) => t.cost === "apify")) return tasks;
  plan.ctx.log("Skipped the paid (Apify) sources: add your Apify token in Settings to use them.");
  return tasks.filter((t) => t.cost !== "apify");
}

/** Collects what the searches find. A paid source hitting the Apify cap stops the other paid sources only. */
class SearchRun {
  readonly found: RawJob[] = [];
  budgetHit = false;

  constructor(private readonly log: Log) {}

  attempt = async (t: SearchTask) => {
    if (t.cost === "apify" && this.budgetHit) return;
    try {
      const jobs = await withTimeout(t.run(), t.timeoutMs, t.label);
      this.found.push(...jobs);
      if (t.label !== "JobSpy") this.log(`${t.label}: ${jobs.length} jobs`);
    } catch (err) {
      if (err instanceof BudgetError) this.budgetHit = true;
      this.log(`${t.label}: ${errorMessage(err)}`);
    }
  };
}

/** Every company board seen in links, saved jobs or the watch list is checked directly. */
async function searchKnownBoards(run: SearchRun, { search, ctx }: Plan) {
  const db = await getDb();
  const saved = await db.select({ link: schema.jobs.link }).from(schema.jobs);
  const added = await rememberBoards([...search.watchCompanies, ...run.found.flatMap((j) => [j.link, j.applyUrl]), ...saved.map((j) => j.link)]);
  if (added) ctx.log(`Found ${added} new company career pages to check`);
  await run.attempt({ label: "Company career pages", cost: "free", timeoutMs: 10 * MIN, run: () => searchCareerPages(ctx) });
}

/** Boards let reposted and promoted listings through their date filters. */
function dropOld(found: RawJob[], postedWithinDays: PostedWithin, log: Log): RawJob[] {
  const recent = found.filter((j) => !postedTooLongAgo(j.posted, postedWithinDays));
  if (recent.length < found.length) {
    log(`Dropped ${found.length - recent.length} jobs posted before the ${postedWithinLabel(postedWithinDays)}`);
  }
  return recent;
}

function logBySource(jobs: RawJob[], log: Log) {
  const bySource = new Map<string, number>();
  for (const j of jobs) bySource.set(j.source, (bySource.get(j.source) ?? 0) + 1);
  if (!bySource.size) return;
  log(`Found by source: ${[...bySource].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(" · ")}`);
}

/**
 * Searches every source switched on in Settings, free ones and paid ones side
 * by side, then the company career pages discovered along the way.
 * A paid source hitting the Apify cap stops the other paid sources only.
 */
export async function findJobs(settings: AppSettings, log: Log, postedWithinDays: PostedWithin, keys: Keys): Promise<RawJob[]> {
  const { search } = settings;
  const on = (key: string) => !!search.sources[key];
  const { titles, own, extra, boardTitles, apifyTitles } = splitTitles(search);

  log(`Looking for jobs posted in the ${postedWithinLabel(postedWithinDays)}`);
  log(`Titles (${titles.length}): ${own.join(", ")}${extra.length ? ` + also ${extra.join(", ")}` : ""}`);

  const ctx: SourceContext = {
    titles,
    boardTitles,
    locations: search.locations,
    postedWithinDays,
    limit: search.maxPerFreeSearch,
    apifyLimit: search.maxPerSearch,
    excludeTitleWords: search.excludeTitleWords,
    log,
  };
  const plan: Plan = { search, ctx, apifyTitles, postedWithinDays, on };
  const run = new SearchRun(log);
  await pool(buildTasks(plan, keys), PARALLEL_SEARCHES, run.attempt);
  if (run.budgetHit) log("Paid sources stopped at the Apify monthly cap; free sources ran as usual.");
  if (on("ats")) await searchKnownBoards(run, plan);

  const recent = dropOld(run.found, postedWithinDays, log);
  logBySource(recent, log);
  return recent;
}
