import type { SearchLocation } from "@/lib/settings";
import { truncate } from "@/lib/util";
import { matchesTitle } from "./match";
import { fetchJson, isoDate, payText, pool, saysRemote, type SourceContext, SourceHttpError, str, stripHtml } from "./net";
import type { RawJob } from "./types";

/**
 * Official job board APIs that are free but need a key you get by signing up:
 * Adzuna (about 19 countries), Reed (UK) and Jooble (about 70 countries).
 */

export type BoardKeys = { adzunaAppId: string; adzunaKey: string; reedKey: string; joobleKey: string };

const DESCRIPTION_MAX = 6000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One search: a title in one place. `remote` searches add the word "remote". */
type Query = { title: string; location: SearchLocation; remote: boolean };

function queries(ctx: SourceContext, covers: (l: SearchLocation) => boolean): Query[] {
  return ctx.locations.filter(covers).flatMap((location) => ctx.boardTitles.map((title) => ({ title, location, remote: location.remote })));
}

const keyword = (q: Query) => (q.remote ? `${q.title} remote` : q.title);
const place = (l: SearchLocation) => (l.remote ? "" : l.indeedLocation || "");
const country = (l: SearchLocation) => {
  const c = l.indeedCountry.trim().toLowerCase();
  return c === "uk" ? "gb" : c;
};

/** Keeps jobs for a search title; the board's own keyword search is loose. */
function keep(ctx: SourceContext, q: Query, jobs: Omit<RawJob, "kind" | "tier" | "company_">[]): RawJob[] {
  return jobs
    .filter((j) => j.role && j.company && j.link && matchesTitle(j.role, ctx.titles, ctx.excludeTitleWords))
    .map((j) => ({ ...j, kind: "listing" as const, tier: q.location.label, company_: {}, description: truncate(j.description, DESCRIPTION_MAX) }));
}

/** A clear message for a missing or refused key; other errors pass through. */
function keyError(board: string, err: unknown): never {
  if (err instanceof SourceHttpError && (err.status === 401 || err.status === 403)) {
    // Jooble answers a wrong key with its Cloudflare block page, so 403 can mean either.
    const why = board === "Jooble" && err.status === 403 ? " It may also be blocking requests from this network for a while." : "";
    throw new Error(`${board} refused the key (${err.status}). Check it in Settings → Keys.${why}`);
  }
  throw err;
}

/** Runs the searches, keeping what worked; throws only when every one failed. */
async function runAll<T>(qs: T[], limit: number, gapMs: number, fn: (q: T) => Promise<RawJob[]>): Promise<RawJob[]> {
  let firstError: unknown = null;
  let ok = 0;
  const out = await pool(qs, limit, async (q, i) => {
    if (gapMs && i >= limit) await sleep(gapMs);
    try {
      const jobs = await fn(q);
      ok++;
      return jobs;
    } catch (err) {
      firstError ??= err;
      return [];
    }
  });
  if (!ok && firstError) throw firstError;
  return out.flat();
}

// ---------- Adzuna ----------

/** Countries Adzuna has a site for, with the currency its salaries are in. */
export const ADZUNA_COUNTRIES: Record<string, string> = {
  gb: "GBP", us: "USD", at: "EUR", au: "AUD", be: "EUR", br: "BRL", ca: "CAD", ch: "CHF", de: "EUR", es: "EUR",
  fr: "EUR", in: "INR", it: "EUR", mx: "MXN", nl: "EUR", nz: "NZD", pl: "PLN", sg: "SGD", za: "ZAR",
};

type AdzunaItem = {
  id?: string | number; title?: string; description?: string; redirect_url?: string; created?: string;
  company?: { display_name?: string }; location?: { display_name?: string }; salary_min?: number; salary_max?: number;
};

export function mapAdzuna(items: AdzunaItem[], cc: string, remoteSearch: boolean) {
  return items.map((i) => {
    const role = stripHtml(i.title);
    const description = stripHtml(i.description);
    const location = str(i.location?.display_name);
    return {
      source: "Adzuna",
      sourceId: `adzuna:${str(i.id)}`,
      company: str(i.company?.display_name),
      role,
      link: str(i.redirect_url),
      location,
      description,
      pay: payText(i.salary_min, i.salary_max, ADZUNA_COUNTRIES[cc] ?? "", "year"),
      mode: (remoteSearch && saysRemote(`${role} ${description}`)) || saysRemote(location) ? "Remote" : "",
      posted: isoDate(i.created),
    };
  });
}

/**
 * One search per title in each location's country. Remote locations search
 * `remoteCountries`, since Adzuna has no worldwide site.
 */
export async function searchAdzuna(ctx: SourceContext, keys: BoardKeys, remoteCountries: string[]): Promise<RawJob[]> {
  if (!keys.adzunaAppId || !keys.adzunaKey) throw new Error("Add your free Adzuna app ID and key in Settings → Keys.");
  const qs: (Query & { cc: string })[] = [];
  for (const q of queries(ctx, () => true)) {
    const ccs = q.remote ? remoteCountries.map((c) => c.toLowerCase()) : [country(q.location)];
    for (const cc of ccs) if (ADZUNA_COUNTRIES[cc]) qs.push({ ...q, cc });
  }
  if (!qs.length) return [];
  // The free plan allows about 25 calls a minute, so the searches are spaced out.
  return runAll(qs, 1, 2500, async (q) => {
    const params = new URLSearchParams({
      app_id: keys.adzunaAppId,
      app_key: keys.adzunaKey,
      what: keyword(q),
      max_days_old: String(ctx.postedWithinDays),
      results_per_page: String(Math.min(50, ctx.limit)),
      sort_by: "date",
      "content-type": "application/json",
    });
    if (place(q.location)) params.set("where", place(q.location));
    const data = await fetchJson<{ results?: AdzunaItem[] }>(`https://api.adzuna.com/v1/api/jobs/${q.cc}/search/1?${params}`).catch((e) => keyError("Adzuna", e));
    return keep(ctx, q, mapAdzuna(data.results ?? [], q.cc, q.remote));
  });
}

// ---------- Reed (UK) ----------

type ReedItem = {
  jobId?: number; employerName?: string; jobTitle?: string; locationName?: string; minimumSalary?: number | null;
  maximumSalary?: number | null; currency?: string | null; date?: string; jobDescription?: string; jobUrl?: string;
};

/** Reed dates are "dd/mm/yyyy". */
export function reedDate(d: unknown): string | undefined {
  const m = str(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? isoDate(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`) : isoDate(d);
}

export function mapReed(items: ReedItem[], remoteSearch: boolean) {
  return items.map((i) => {
    const role = str(i.jobTitle);
    const description = stripHtml(i.jobDescription);
    const location = str(i.locationName);
    return {
      source: "Reed",
      sourceId: `reed:${str(i.jobId)}`,
      company: str(i.employerName),
      role,
      link: str(i.jobUrl),
      location,
      description,
      // Reed gives no pay period: UK listings are yearly, except contract day rates.
      pay: payText(i.minimumSalary, i.maximumSalary, i.currency || "GBP", Number(i.maximumSalary || i.minimumSalary) < 2000 ? "day" : "year"),
      mode: (remoteSearch && saysRemote(`${role} ${description}`)) || saysRemote(location) ? "Remote" : "",
      posted: reedDate(i.date),
    };
  });
}

/** UK locations, and remote locations (UK employers hiring remotely). */
export async function searchReed(ctx: SourceContext, keys: BoardKeys): Promise<RawJob[]> {
  if (!keys.reedKey) throw new Error("Add your free Reed key in Settings → Keys.");
  const qs = queries(ctx, (l) => l.remote || country(l) === "gb");
  if (!qs.length) return [];
  const auth = `Basic ${Buffer.from(`${keys.reedKey}:`).toString("base64")}`;
  return runAll(qs, 2, 0, async (q) => {
    const params = new URLSearchParams({ keywords: keyword(q), resultsToTake: String(Math.min(100, ctx.limit)) });
    if (place(q.location)) params.set("locationName", place(q.location));
    const data = await fetchJson<{ results?: ReedItem[] }>(`https://www.reed.co.uk/api/1.0/search?${params}`, { headers: { authorization: auth } }).catch((e) =>
      keyError("Reed", e),
    );
    return keep(ctx, q, mapReed(data.results ?? [], q.remote));
  });
}

// ---------- Jooble ----------

type JoobleItem = {
  id?: string | number; title?: string; location?: string; snippet?: string; salary?: string; source?: string;
  type?: string; link?: string; company?: string; updated?: string;
};

export function mapJooble(items: JoobleItem[], remoteSearch: boolean) {
  return items.map((i) => {
    const role = stripHtml(i.title);
    const description = stripHtml(i.snippet);
    const location = str(i.location);
    return {
      source: "Jooble",
      sourceId: `jooble:${str(i.id)}`,
      company: str(i.company),
      role,
      link: str(i.link),
      location,
      description,
      pay: str(i.salary),
      mode: (remoteSearch && saysRemote(`${role} ${description} ${str(i.type)}`)) || saysRemote(location) ? "Remote" : "",
      posted: isoDate(i.updated),
    };
  });
}

export async function searchJooble(ctx: SourceContext, keys: BoardKeys): Promise<RawJob[]> {
  if (!keys.joobleKey) throw new Error("Add your free Jooble key in Settings → Keys.");
  const qs = queries(ctx, () => true);
  const since = new Date(Date.now() - ctx.postedWithinDays * 86_400_000).toISOString().slice(0, 10);
  return runAll(qs, 2, 0, async (q) => {
    const data = await fetchJson<{ jobs?: JoobleItem[] }>(`https://jooble.org/api/${encodeURIComponent(keys.joobleKey)}`, {
      body: {
        keywords: keyword(q),
        location: q.remote ? "" : place(q.location) || q.location.linkedin,
        page: "1",
        ResultOnPage: String(Math.min(100, ctx.limit)),
        datecreatedfrom: since,
      },
    }).catch((e) => keyError("Jooble", e));
    return keep(ctx, q, mapJooble(data.jobs ?? [], q.remote));
  });
}
