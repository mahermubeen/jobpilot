import { truncate } from "@/lib/util";
import { matchesTitle } from "./match";
import { decodeEntities, fetchJson, fetchText, isoDate, payText, pool, type SourceContext, str, stripHtml } from "./net";
import type { RawJob } from "./types";

/**
 * Free remote-job boards with public APIs. Each is fetched once per run and
 * matched against every search title on this machine, so more titles cost nothing.
 * Their terms ask for a link back to the listing, which every job keeps.
 */

const DESCRIPTION_MAX = 6000;

type Base = Omit<RawJob, "kind" | "company_" | "tier" | "mode"> & Partial<Pick<RawJob, "mode" | "company_">>;

function keep(ctx: SourceContext, jobs: Base[]): RawJob[] {
  const tier = ctx.locations.find((l) => l.remote)?.label ?? "Remote";
  return jobs
    .filter((j) => j.role && j.company && j.link && matchesTitle(j.role, ctx.titles, ctx.excludeTitleWords))
    .map((j) => ({
      kind: "listing" as const,
      mode: "Remote",
      company_: {},
      tier,
      ...j,
      description: truncate(j.description, DESCRIPTION_MAX),
    }));
}

// ---------- Remote OK ----------

type RemoteOkItem = {
  id?: string; slug?: string; company?: string; position?: string; description?: string; location?: string;
  url?: string; apply_url?: string; date?: string; salary_min?: number; salary_max?: number; tags?: string[];
};

export function mapRemoteOk(items: RemoteOkItem[]): Base[] {
  // The first item is the API's legal notice.
  return items
    .filter((i) => i.position && i.company)
    .map((i) => ({
      source: "Remote OK",
      sourceId: str(i.id),
      company: str(i.company),
      role: decodeEntities(str(i.position)),
      link: str(i.url),
      location: str(i.location) || "Remote",
      description: stripHtml(i.description),
      pay: payText(i.salary_min, i.salary_max, "USD", "year"),
      posted: str(i.date),
    }));
}

export async function searchRemoteOk(ctx: SourceContext) {
  return keep(ctx, mapRemoteOk(await fetchJson<RemoteOkItem[]>("https://remoteok.com/api")));
}

// ---------- Remotive ----------

type RemotiveItem = {
  id?: number; url?: string; title?: string; company_name?: string; publication_date?: string;
  candidate_required_location?: string; salary?: string; description?: string;
};

export function mapRemotive(items: RemotiveItem[]): Base[] {
  return items.map((i) => ({
    source: "Remotive",
    sourceId: str(i.id),
    company: str(i.company_name),
    role: str(i.title),
    link: str(i.url),
    location: str(i.candidate_required_location) || "Remote",
    description: stripHtml(i.description),
    pay: str(i.salary),
    posted: str(i.publication_date),
  }));
}

export async function searchRemotive(ctx: SourceContext) {
  // Remotive asks for few calls a day, so the whole feed is fetched once and matched here.
  const data = await fetchJson<{ jobs?: RemotiveItem[] }>("https://remotive.com/api/remote-jobs", { timeoutMs: 60_000 });
  return keep(ctx, mapRemotive(data.jobs ?? []));
}

// ---------- We Work Remotely ----------

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")).trim() : "";
};

export function mapWeWorkRemotely(xml: string): Base[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, item]) => {
    // Titles read "Company: Role".
    const title = tag(item, "title");
    const cut = title.indexOf(":");
    const link = tag(item, "link") || tag(item, "guid");
    return {
      source: "We Work Remotely",
      sourceId: link,
      company: cut > 0 ? title.slice(0, cut).trim() : "",
      role: cut > 0 ? title.slice(cut + 1).trim() : title,
      link,
      location: tag(item, "region") || tag(item, "country") || "Remote",
      description: stripHtml(tag(item, "description")),
      pay: "",
      posted: isoDate(tag(item, "pubDate")),
    };
  });
}

export async function searchWeWorkRemotely(ctx: SourceContext) {
  return keep(ctx, mapWeWorkRemotely(await fetchText("https://weworkremotely.com/remote-jobs.rss", { timeoutMs: 60_000 })));
}

// ---------- Himalayas ----------

type HimalayasItem = {
  title?: string; excerpt?: string; description?: string; companyName?: string; minSalary?: number | null;
  maxSalary?: number | null; currency?: string; salaryPeriod?: string; locationRestrictions?: string[];
  pubDate?: number; applicationLink?: string; guid?: string;
};

export function mapHimalayas(items: HimalayasItem[]): Base[] {
  return items.map((i) => ({
    source: "Himalayas",
    sourceId: str(i.guid) || str(i.applicationLink),
    company: str(i.companyName),
    role: str(i.title),
    link: str(i.applicationLink) || str(i.guid),
    // No restrictions means anyone anywhere can apply.
    location: i.locationRestrictions?.length ? `Remote (${i.locationRestrictions.join(", ")})` : "Remote, worldwide",
    description: stripHtml(i.description) || str(i.excerpt),
    pay: payText(i.minSalary, i.maxSalary, i.currency, i.salaryPeriod),
    posted: isoDate(i.pubDate),
  }));
}

export async function searchHimalayas(ctx: SourceContext) {
  const pages = await pool(ctx.titles, 3, async (t) => {
    const data = await fetchJson<{ jobs?: HimalayasItem[] }>(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(t)}`);
    return data.jobs ?? [];
  });
  return keep(ctx, mapHimalayas(pages.flat()));
}

// ---------- Jobicy ----------

type JobicyItem = {
  id?: number; url?: string; jobTitle?: string; companyName?: string; jobGeo?: string; jobDescription?: string;
  jobExcerpt?: string; pubDate?: string; salaryMin?: number; salaryMax?: number; salaryCurrency?: string; salaryPeriod?: string;
};

export function mapJobicy(items: JobicyItem[]): Base[] {
  return items.map((i) => ({
    source: "Jobicy",
    sourceId: str(i.id),
    company: str(i.companyName),
    role: decodeEntities(str(i.jobTitle)),
    link: str(i.url),
    location: /anywhere/i.test(str(i.jobGeo)) ? "Remote, worldwide" : `Remote (${str(i.jobGeo) || "unspecified"})`,
    description: stripHtml(i.jobDescription) || stripHtml(i.jobExcerpt),
    pay: payText(i.salaryMin, i.salaryMax, i.salaryCurrency, i.salaryPeriod),
    posted: str(i.pubDate),
  }));
}

export async function searchJobicy(ctx: SourceContext) {
  const pages = await pool(ctx.boardTitles, 2, async (t) => {
    const data = await fetchJson<{ jobs?: JobicyItem[] }>(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(t)}`);
    return data.jobs ?? [];
  });
  return keep(ctx, mapJobicy(pages.flat()));
}

// ---------- Arbeitnow ----------

type ArbeitnowItem = {
  slug?: string; company_name?: string; title?: string; description?: string; remote?: boolean; url?: string;
  location?: string; created_at?: number;
};

export function mapArbeitnow(items: ArbeitnowItem[]): Base[] {
  return items.map((i) => ({
    source: "Arbeitnow",
    sourceId: str(i.slug),
    company: str(i.company_name),
    role: str(i.title),
    link: str(i.url),
    location: i.remote ? `Remote (${str(i.location) || "Germany"})` : str(i.location),
    mode: i.remote ? "Remote" : "",
    description: stripHtml(i.description),
    pay: "",
    posted: isoDate(i.created_at),
  }));
}

export async function searchArbeitnow(ctx: SourceContext) {
  const data = await fetchJson<{ data?: ArbeitnowItem[] }>("https://www.arbeitnow.com/api/job-board-api", { timeoutMs: 60_000 });
  const tier = ctx.locations[0]?.label ?? "";
  return keep(ctx, mapArbeitnow(data.data ?? [])).map((j) => (j.mode ? j : { ...j, tier }));
}
