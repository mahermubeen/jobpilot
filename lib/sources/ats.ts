import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { errorMessage, truncate } from "@/lib/util";
import { matchesTitle } from "./match";
import { decodeEntities, fetchJson, isoDate, payText, pool, saysRemote, type SourceContext, str, stripHtml } from "./net";
import type { RawJob } from "./types";

/**
 * Company job boards on applicant-tracking systems, read through their public
 * JSON APIs. Every board JobPilot has ever seen a link to is remembered and
 * checked again, so this source finds more with every run.
 */

export type Ats = "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters" | "recruitee";
export type Board = { ats: Ats; slug: string };

const pretty = (slug: string) =>
  slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

const SLUG = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

const board = (ats: Ats, slug: string | null | undefined): Board | null =>
  slug && SLUG.test(slug) ? { ats, slug: slug.toLowerCase() } : null;

type BoardUrl = { host: string; parts: string[]; first: string; url: URL };

/** One rule per system: does this host belong to it, and where in the URL is the board's slug. */
const BOARD_RULES: { matches: (b: BoardUrl) => boolean; find: (b: BoardUrl) => Board | null }[] = [
  {
    matches: ({ host }) => /^(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(host),
    find: ({ first, url }) => board("greenhouse", first === "embed" ? url.searchParams.get("for") : first),
  },
  { matches: ({ host }) => host === "boards-api.greenhouse.io", find: ({ parts }) => board("greenhouse", parts[2]) },
  { matches: ({ host }) => host === "jobs.lever.co", find: ({ first }) => board("lever", first) },
  { matches: ({ host }) => host === "jobs.ashbyhq.com", find: ({ first }) => board("ashby", first) },
  {
    matches: ({ host, first }) => host === "apply.workable.com" && first !== "j" && first !== "api",
    find: ({ first }) => board("workable", first),
  },
  {
    matches: ({ host }) => host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com",
    find: ({ parts }) => board("smartrecruiters", parts[0]),
  },
  {
    matches: ({ host }) => /^([a-z0-9-]+)\.recruitee\.com$/.test(host) && !host.startsWith("www."),
    find: ({ host }) => board("recruitee", host.split(".")[0]),
  },
];

function parseBoardUrl(url: string | null | undefined): BoardUrl | null {
  try {
    const u = new URL(url ?? "");
    const parts = u.pathname.split("/").filter(Boolean);
    return { url: u, host: u.hostname.toLowerCase().replace(/^www\./, ""), parts, first: (parts[0] ?? "").toLowerCase() };
  } catch {
    return null;
  }
}

/** Which company board a job or careers URL belongs to, or null. */
export function detectBoard(url: string | null | undefined): Board | null {
  const parsed = parseBoardUrl(url);
  if (!parsed) return null;
  return BOARD_RULES.find((r) => r.matches(parsed))?.find(parsed) ?? null;
}

type Base = Omit<RawJob, "kind" | "company_" | "tier" | "source" | "mode"> & { mode?: string };

// ---------- one reader per system ----------

type GreenhouseJob = { id?: number; title?: string; absolute_url?: string; location?: { name?: string }; content?: string; first_published?: string; updated_at?: string; company_name?: string };

export function mapGreenhouse(slug: string, data: { jobs?: GreenhouseJob[] }): Base[] {
  return (data.jobs ?? []).map((j) => ({
    sourceId: `greenhouse:${slug}:${j.id}`,
    company: str(j.company_name) || pretty(slug),
    role: str(j.title),
    link: str(j.absolute_url),
    location: str(j.location?.name),
    // Greenhouse escapes its HTML once more.
    description: stripHtml(decodeEntities(str(j.content))),
    pay: "",
    posted: isoDate(str(j.first_published) || str(j.updated_at)),
  }));
}

type LeverJob = {
  id?: string; text?: string; hostedUrl?: string; categories?: { location?: string; allLocations?: string[] }; workplaceType?: string;
  createdAt?: number; descriptionPlain?: string; additionalPlain?: string; salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
};

const REMOTE_SUFFIX = " (Remote)";
const remoteSuffix = (remote: boolean | undefined) => (remote ? REMOTE_SUFFIX : "");

const LEVER_MODES: Record<string, string> = { remote: "Remote", hybrid: "Hybrid" };

function leverLocation(j: LeverJob): string {
  const all = j.categories?.allLocations;
  return (all?.length ? all.join(" / ") : str(j.categories?.location)) + remoteSuffix(j.workplaceType === "remote");
}

const leverPay = (range: LeverJob["salaryRange"] = {}) => payText(range.min, range.max, range.currency, range.interval);

export function mapLever(slug: string, data: LeverJob[]): Base[] {
  return (Array.isArray(data) ? data : []).map((j) => ({
    sourceId: `lever:${slug}:${j.id}`,
    company: pretty(slug),
    role: str(j.text),
    link: str(j.hostedUrl),
    location: leverLocation(j),
    mode: LEVER_MODES[j.workplaceType ?? ""] ?? "",
    description: [str(j.descriptionPlain), str(j.additionalPlain)].filter(Boolean).join("\n\n"),
    pay: leverPay(j.salaryRange),
    posted: isoDate(j.createdAt),
  }));
}

type AshbyJob = {
  id?: string; title?: string; jobUrl?: string; location?: string; secondaryLocations?: { location?: string }[]; isRemote?: boolean;
  isListed?: boolean; publishedAt?: string; descriptionPlain?: string; compensation?: { compensationTierSummary?: string };
};

export function mapAshby(slug: string, data: { jobs?: AshbyJob[] }): Base[] {
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      sourceId: `ashby:${slug}:${j.id}`,
      company: pretty(slug),
      role: str(j.title),
      link: str(j.jobUrl),
      location: [str(j.location), ...(j.secondaryLocations ?? []).map((l) => str(l.location))].filter(Boolean).join(" / "),
      mode: j.isRemote ? "Remote" : "",
      description: str(j.descriptionPlain),
      pay: str(j.compensation?.compensationTierSummary),
      posted: isoDate(j.publishedAt),
    }));
}

type WorkableJob = {
  shortcode?: string; title?: string; url?: string; city?: string; state?: string; country?: string; telecommuting?: boolean;
  published_on?: string; description?: string;
};

export function mapWorkable(slug: string, data: { name?: string; jobs?: WorkableJob[] }): Base[] {
  return (data.jobs ?? []).map((j) => ({
    sourceId: `workable:${slug}:${j.shortcode}`,
    company: str(data.name) || pretty(slug),
    role: str(j.title),
    link: str(j.url),
    location: [str(j.city), str(j.state), str(j.country)].filter(Boolean).join(", ") + remoteSuffix(j.telecommuting),
    mode: j.telecommuting ? "Remote" : "",
    description: stripHtml(j.description),
    pay: "",
    posted: isoDate(j.published_on),
  }));
}

type SmartRecruitersJob = {
  id?: string; name?: string; company?: { name?: string }; releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean; fullLocation?: string };
};

function smartRecruitersLocation(loc: SmartRecruitersJob["location"] = {}): string {
  const place = str(loc.fullLocation) || [str(loc.city), str(loc.region), str(loc.country).toUpperCase()].filter(Boolean).join(", ");
  return place + remoteSuffix(loc.remote);
}

export function mapSmartRecruiters(slug: string, data: { content?: SmartRecruitersJob[] }): Base[] {
  return (data.content ?? []).map((j) => ({
    sourceId: `smartrecruiters:${slug}:${j.id}`,
    company: str(j.company?.name) || pretty(slug),
    role: str(j.name),
    link: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
    location: smartRecruitersLocation(j.location),
    mode: j.location?.remote ? "Remote" : "",
    description: "",
    pay: "",
    posted: isoDate(j.releasedDate),
  }));
}

type RecruiteeOffer = {
  id?: number; title?: string; careers_url?: string; location?: string; remote?: boolean; published_at?: string;
  description?: string; requirements?: string; company_name?: string;
};

export function mapRecruitee(slug: string, data: { offers?: RecruiteeOffer[] }): Base[] {
  return (data.offers ?? []).map((j) => ({
    sourceId: `recruitee:${slug}:${j.id}`,
    company: str(j.company_name) || pretty(slug),
    role: str(j.title),
    link: str(j.careers_url),
    location: str(j.location) + remoteSuffix(j.remote),
    mode: j.remote ? "Remote" : "",
    description: [stripHtml(j.description), stripHtml(j.requirements)].filter(Boolean).join("\n\n"),
    pay: "",
    posted: isoDate(j.published_at),
  }));
}

const LABEL: Record<Ats, string> = {
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workable: "Workable", smartrecruiters: "SmartRecruiters", recruitee: "Recruitee",
};

export async function fetchBoard({ ats, slug }: Board): Promise<Base[]> {
  const s = encodeURIComponent(slug);
  switch (ats) {
    case "greenhouse":
      return mapGreenhouse(slug, await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`));
    case "lever":
      return mapLever(slug, await fetchJson(`https://api.lever.co/v0/postings/${s}?mode=json`));
    case "ashby":
      return mapAshby(slug, await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true`));
    case "workable":
      return mapWorkable(slug, await fetchJson(`https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`));
    case "smartrecruiters":
      return mapSmartRecruiters(slug, await fetchJson(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`));
    case "recruitee":
      return mapRecruitee(slug, await fetchJson(`https://${s}.recruitee.com/api/offers/`));
  }
}

// ---------- the remembered boards ----------

const boardId = (b: Board) => `${b.ats}:${b.slug}`;
const INSERT_BATCH = 200;

/** Saves the boards behind these URLs so later runs check them directly. Returns how many were new. */
export async function rememberBoards(urls: (string | null | undefined)[]): Promise<number> {
  const boards = new Map<string, Board>();
  for (const url of urls) {
    const b = detectBoard(url);
    if (b) boards.set(boardId(b), b);
  }
  if (!boards.size) return 0;
  const db = await getDb();
  const rows = [...boards.entries()].map(([id, b]) => ({ id, ats: b.ats, slug: b.slug }));
  const batches = Array.from({ length: Math.ceil(rows.length / INSERT_BATCH) }, (_, i) => rows.slice(i * INSERT_BATCH, (i + 1) * INSERT_BATCH));
  // Batches are independent (conflicts are skipped), so they can be written together.
  const inserted = await Promise.all(
    batches.map((batch) => db.insert(schema.atsBoards).values(batch).onConflictDoNothing().returning({ id: schema.atsBoards.id })),
  );
  return inserted.reduce((n, rowsAdded) => n + rowsAdded.length, 0);
}

const RECHECK_MS = 12 * 36e5;
const MAX_FAILURES = 3;

type Db = Awaited<ReturnType<typeof getDb>>;
type BoardRow = typeof schema.atsBoards.$inferSelect;

/** Boards not checked in the last 12 hours and not failing, oldest check first. */
function dueBoards(db: Db, maxBoards: number) {
  return db
    .select()
    .from(schema.atsBoards)
    .where(
      and(
        lt(schema.atsBoards.failures, MAX_FAILURES),
        or(isNull(schema.atsBoards.checkedAt), lt(schema.atsBoards.checkedAt, new Date(Date.now() - RECHECK_MS))),
      ),
    )
    .orderBy(sql`${schema.atsBoards.checkedAt} asc nulls first`, asc(schema.atsBoards.createdAt))
    .limit(maxBoards);
}

type Tiers = { remote: string | undefined; onsite: string };

function toCareerJob(j: Base, ats: Ats, tiers: Tiers): RawJob {
  const isRemote = j.mode === "Remote" || saysRemote(`${j.location} ${j.role}`);
  return {
    ...j,
    source: LABEL[ats],
    kind: "listing",
    mode: j.mode || (isRemote ? "Remote" : ""),
    tier: (isRemote ? tiers.remote : tiers.onsite) ?? "",
    description: truncate(j.description, 6000),
    company_: {},
  };
}

/** Reads one board, records the check, and keeps the jobs matching a search title. */
async function checkBoard(db: Db, row: BoardRow, ctx: SourceContext, tiers: Tiers): Promise<RawJob[]> {
  const ats = row.ats as Ats;
  const jobs = await fetchBoard({ ats, slug: row.slug });
  await db
    .update(schema.atsBoards)
    .set({ checkedAt: new Date(), failures: 0, company: jobs[0]?.company ?? row.company })
    .where(eq(schema.atsBoards.id, row.id));
  return jobs
    .filter((j) => j.role && j.link && matchesTitle(j.role, ctx.titles, ctx.excludeTitleWords))
    .map((j) => toCareerJob(j, ats, tiers));
}

const recordFailure = (db: Db, row: BoardRow) =>
  db.update(schema.atsBoards).set({ checkedAt: new Date(), failures: row.failures + 1 }).where(eq(schema.atsBoards.id, row.id));

const MAX_LOGGED_FAILURES = 3;

/** Checks the remembered boards not looked at in the last 12 hours and keeps jobs matching a search title. */
export async function searchCareerPages(ctx: SourceContext, maxBoards = 300): Promise<RawJob[]> {
  const db = await getDb();
  const due = await dueBoards(db, maxBoards);
  if (!due.length) {
    ctx.log("Company career pages: none due (each board is checked at most every 12 hours)");
    return [];
  }
  const remote = ctx.locations.find((l) => l.remote)?.label;
  const tiers: Tiers = { remote, onsite: ctx.locations.find((l) => !l.remote)?.label ?? remote ?? "" };
  let failed = 0;
  const found = await pool(due, 8, async (row) => {
    try {
      return await checkBoard(db, row, ctx, tiers);
    } catch (err) {
      failed++;
      await recordFailure(db, row);
      if (failed <= MAX_LOGGED_FAILURES) ctx.log(`Career page ${row.id}: ${errorMessage(err)}`);
      return [];
    }
  });
  ctx.log(`Company career pages: checked ${due.length - failed} of ${due.length} boards`);
  return found.flat();
}
