import { truncate } from "@/lib/util";
import { runActor } from "./apify";
import { matchesTitle } from "./match";
import { isoDate, saysRemote, type SourceContext, str } from "./net";
import { companyFromText } from "./social";
import type { RawJob } from "./types";

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

const GIG = /\/cpg\/|computer gigs?/i;

const cityOf = (i: CraigslistItem, link: string) => str(i.region) || (link.match(/\/\/([a-z0-9-]+)\.craigslist/)?.[1] ?? "");

function craigslistToJob(i: CraigslistItem, role: string, link: string, tier: string): RawJob {
  const description = str(i.description);
  const region = cityOf(i, link);
  return {
    source: "Craigslist",
    kind: GIG.test(`${link} ${str(i.categorySlug)}`) ? "post" : "listing",
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
  };
}

export function mapCraigslist(items: CraigslistItem[], tier: string): RawJob[] {
  return items.flatMap((i) => {
    const role = str(i.title);
    const link = str(i.url);
    return role && link ? [craigslistToJob(i, role, link, tier)] : [];
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
