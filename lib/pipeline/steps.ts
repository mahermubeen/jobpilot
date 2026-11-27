import { and, eq, inArray, isNull } from "drizzle-orm";
import { draftApplication, draftFollowUp, scoreJobs, type OutreachDraft } from "@/lib/ai/tasks";
import { researchCompany } from "@/lib/apply/research";
import { profileIsReady, type Profile } from "@/lib/cv/types";
import { getDb, schema } from "@/lib/db";
import type { Company, Job } from "@/lib/db/schema";
import { findReplies } from "@/lib/mail/imap";
import { describeMinPay } from "@/lib/pay";
import type { AppSettings, Secrets, SearchLocation } from "@/lib/settings";
import { apolloCompany, apolloPeople, hasApollo } from "@/lib/sources/apollo";
import { BudgetError } from "@/lib/sources/apify";
import { findWebsites, rankEmails, scrapeSites } from "@/lib/sources/contacts";
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
import { JOBSPY_SITES, SITE_LABEL, searchJobSpy } from "@/lib/sources/jobspy";
import { searchTitles } from "@/lib/sources/match";
import { pool, type SourceContext } from "@/lib/sources/net";
import { searchHackerNews, searchReddit } from "@/lib/sources/social";
import { parsePosted, postedTooLongAgo, postedWithinLabel, type PostedWithin } from "@/lib/sources/posted";
import type { RawJob, SiteContacts } from "@/lib/sources/types";
import { chunk, daysBetween, domainOf, errorMessage, slug, today, uid } from "@/lib/util";
import { companyId, dedupeJobs, findDuplicates, jobId } from "./dedupe";
import { dismissedKeys } from "./forget";
import { homePlaces, rejectReason, type JobFilter } from "./filter";

export type Log = (line: string) => void;

// ---------- find ----------

type SearchTask = {
  label: string;
  cost: "free" | "apify";
  timeoutMs: number;
  run: () => Promise<RawJob[]>;
};

const withTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} took longer than ${Math.round(ms / 60_000)} minutes; skipped.`)), ms),
    ),
  ]);

/**
 * Searches every source switched on in Settings, free ones and paid ones side
 * by side, then the company career pages discovered along the way.
 * A paid source hitting the Apify cap stops the other paid sources only.
 */
export async function findJobs(
  settings: AppSettings,
  log: Log,
  postedWithinDays: PostedWithin,
  keys: BoardKeys & Pick<Secrets, "apifyToken">,
): Promise<RawJob[]> {
  const { search } = settings;
  const on = (key: string) => !!search.sources[key];
  const titles = searchTitles(search);
  const own = titles.filter((t) => search.titles.some((o) => o.trim() === t));
  const extra = titles.filter((t) => !own.includes(t));
  // Searches that cost time or money per title use your own titles, topped up
  // with the first variants only while the list is short.
  const boardTitles = [...own, ...extra].slice(0, Math.max(own.length, 8));
  const apifyTitles = [...own, ...extra].slice(0, Math.max(own.length, 4));

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
  const found: RawJob[] = [];
  let budgetHit = false;
  const MIN = 60_000;
  const tasks: SearchTask[] = [];

  // Free job boards, scraped together by one JobSpy process.
  const jobspySites = JOBSPY_SITES.filter((s) => on(`jobspy-${s}`));
  if (jobspySites.length) {
    tasks.push({
      label: "JobSpy",
      cost: "free",
      // JobSpy keeps what it found when its own 15-minute budget runs out.
      timeoutMs: 20 * MIN,
      run: async () => {
        const { jobs, errors } = await searchJobSpy(ctx, jobspySites, 15 * MIN);
        for (const site of jobspySites) {
          const errs = errors[site] ?? [];
          log(`${SITE_LABEL[site]}: ${jobs[site]?.length ?? 0} jobs${errs.length ? ` (${errs.length} searches failed: ${errs[0]})` : ""}`);
        }
        return jobspySites.flatMap((s) => jobs[s] ?? []);
      },
    });
  }

  const free: [string, string, (c: SourceContext) => Promise<RawJob[]>][] = [
    ["remoteok", "Remote OK", searchRemoteOk],
    ["remotive", "Remotive", searchRemotive],
    ["weworkremotely", "We Work Remotely", searchWeWorkRemotely],
    ["himalayas", "Himalayas", searchHimalayas],
    ["jobicy", "Jobicy", searchJobicy],
    ["arbeitnow", "Arbeitnow", searchArbeitnow],
    ["hn", "Hacker News", searchHackerNews],
    ["reddit", "Reddit", searchReddit],
  ];
  for (const [key, label, fn] of free) {
    if (on(key)) tasks.push({ label, cost: "free", timeoutMs: 3 * MIN, run: () => fn(ctx) });
  }

  // Free official APIs that need a key; without one they are skipped with a note.
  const keyed: [string, string, boolean, () => Promise<RawJob[]>][] = [
    ["adzuna", "Adzuna", !!(keys.adzunaAppId && keys.adzunaKey), () => searchAdzuna(ctx, keys, search.remoteCountries)],
    ["reed", "Reed", !!keys.reedKey, () => searchReed(ctx, keys)],
    ["jooble", "Jooble", !!keys.joobleKey, () => searchJooble(ctx, keys)],
  ];
  const noKey: string[] = [];
  for (const [key, label, hasKey, run] of keyed) {
    if (!on(key)) continue;
    if (hasKey) tasks.push({ label, cost: "free", timeoutMs: 8 * MIN, run });
    else noKey.push(label);
  }
  if (noKey.length) log(`Skipped ${noKey.join(", ")}: add the free key${noKey.length > 1 ? "s" : ""} in Settings → Keys.`);

  // Paid boards: one Apify run per title and location.
  const paidBoards: [string, string, (s: SearchInput) => Promise<RawJob[]>, (l: SearchLocation) => boolean][] = [
    ["linkedin", "LinkedIn (Apify)", searchLinkedIn, (l) => !!l.linkedin],
    ["indeed", "Indeed (Apify)", searchIndeed, (l) => !!l.indeedCountry],
    ["glassdoor", "Glassdoor (Apify)", searchGlassdoor, () => true],
    ["wellfound", "Wellfound (Apify)", searchWellfound, () => true],
  ];
  for (const [key, label, fn, covers] of paidBoards) {
    if (!on(key)) continue;
    for (const location of search.locations.filter(covers)) {
      for (const title of apifyTitles) {
        const input = { title, location, postedWithinDays, limit: search.maxPerSearch, excludeTitleWords: search.excludeTitleWords };
        tasks.push({ label: `${label} "${title}" in ${location.label}`, cost: "apify", timeoutMs: 11 * MIN, run: () => fn(input) });
      }
    }
  }
  if (on("google") && apifyTitles.length) {
    const remote = search.locations.find((l) => l.remote);
    tasks.push({
      label: "Google career boards (Apify)",
      cost: "apify",
      timeoutMs: 11 * MIN,
      run: () =>
        searchGoogle(apifyTitles, {
          remoteOnly: !!remote,
          postedWithinDays,
          tier: remote?.label ?? search.locations[0]?.label ?? "",
          excludeTitleWords: search.excludeTitleWords,
        }),
    });
  }
  const paidPosts: [string, string, (c: SourceContext) => Promise<RawJob[]>][] = [
    ["linkedin-posts", "LinkedIn hiring posts (Apify)", searchLinkedInPosts],
    ["x-posts", "X hiring posts (Apify)", searchXPosts],
    ["reddit-apify", "Reddit (Apify)", searchRedditApify],
  ];
  for (const [key, label, fn] of paidPosts) {
    if (on(key)) tasks.push({ label, cost: "apify", timeoutMs: 11 * MIN, run: () => fn(ctx) });
  }
  if (on("craigslist") && apifyTitles.length) {
    tasks.push({ label: "Craigslist (Apify)", cost: "apify", timeoutMs: 11 * MIN, run: () => searchCraigslist(ctx, apifyTitles, search.craigslistCities) });
  }
  // Paid sources need the Apify token; without it the free ones still run.
  if (!keys.apifyToken && tasks.some((t) => t.cost === "apify")) {
    log("Skipped the paid (Apify) sources: add your Apify token in Settings to use them.");
    tasks.splice(0, tasks.length, ...tasks.filter((t) => t.cost !== "apify"));
  }

  const attempt = async (t: SearchTask) => {
    if (t.cost === "apify" && budgetHit) return;
    try {
      const jobs = await withTimeout(t.run(), t.timeoutMs, t.label);
      found.push(...jobs);
      if (t.label !== "JobSpy") log(`${t.label}: ${jobs.length} jobs`);
    } catch (err) {
      if (err instanceof BudgetError) budgetHit = true;
      log(`${t.label}: ${errorMessage(err)}`);
    }
  };
  // JobSpy is the slowest, so it starts first and the rest share the other slots.
  await pool(tasks, 4, attempt);
  if (budgetHit) log("Paid sources stopped at the Apify monthly cap; free sources ran as usual.");

  // Every company board seen in links, saved jobs or the watch list is checked directly.
  if (on("ats")) {
    const db = await getDb();
    const saved = await db.select({ link: schema.jobs.link }).from(schema.jobs);
    const added = await rememberBoards([
      ...search.watchCompanies,
      ...found.flatMap((j) => [j.link, j.applyUrl]),
      ...saved.map((j) => j.link),
    ]);
    if (added) log(`Found ${added} new company career pages to check`);
    await attempt({ label: "Company career pages", cost: "free", timeoutMs: 10 * MIN, run: () => searchCareerPages(ctx) });
  }

  // Boards let reposted and promoted listings through their date filters.
  const recent = found.filter((j) => !postedTooLongAgo(j.posted, postedWithinDays));
  if (recent.length < found.length) {
    log(`Dropped ${found.length - recent.length} jobs posted before the ${postedWithinLabel(postedWithinDays)}`);
  }
  const bySource = new Map<string, number>();
  for (const j of recent) bySource.set(j.source, (bySource.get(j.source) ?? 0) + 1);
  if (bySource.size) {
    log(`Found by source: ${[...bySource].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(" · ")}`);
  }
  return recent;
}

// ---------- store ----------

export async function upsertCompany(
  name: string,
  info: RawJob["company_"] = {},
): Promise<string> {
  const db = await getDb();
  const id = companyId(name);
  const [existing] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
  const clean = Object.fromEntries(
    Object.entries(info).filter(([, v]) => typeof v === "string" && v.trim()),
  ) as Partial<Company>;
  if (!existing) {
    await db.insert(schema.companies).values({ id, name, ...clean });
  } else {
    // Only fill gaps; never overwrite what the user or an earlier lookup saved.
    const patch = Object.fromEntries(
      Object.entries(clean).filter(([k]) => !existing[k as keyof Company]),
    );
    if (Object.keys(patch).length) {
      await db
        .update(schema.companies)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.companies.id, id));
    }
  }
  return id;
}

/**
 * Saved jobs that turn out to be the same posting (saved before the duplicate
 * check knew them apart) are merged: the copy furthest along stays and lists
 * the others' sources. Only copies still in Found or Skipped without a sent
 * email are removed; jobs you acted on are never touched.
 */
async function mergeSavedDuplicates(log: Log) {
  const db = await getDb();
  const jobs = await db
    .select({
      id: schema.jobs.id, company: schema.jobs.company, role: schema.jobs.role, link: schema.jobs.link,
      source: schema.jobs.source, sourceId: schema.jobs.sourceId, status: schema.jobs.status, alsoOn: schema.jobs.alsoOn,
    })
    .from(schema.jobs);
  const sent = new Set(
    (await db.select({ jobId: schema.outbox.jobId }).from(schema.outbox).where(eq(schema.outbox.status, "sent"))).map((o) => o.jobId),
  );
  let removed = 0;
  for (const { keep, extra } of findDuplicates(jobs)) {
    const drop = extra.filter((j) => ["Found", "Skipped"].includes(j.status) && !sent.has(j.id));
    if (!drop.length) continue;
    const alsoOn = [...new Set([...(keep.alsoOn ?? []), ...drop.map((j) => j.source ?? "")])].filter((s) => s && s !== keep.source);
    await db.update(schema.jobs).set({ alsoOn }).where(eq(schema.jobs.id, keep.id));
    const ids = drop.map((j) => j.id);
    await db.delete(schema.outbox).where(inArray(schema.outbox.jobId, ids));
    await db.delete(schema.jobs).where(inArray(schema.jobs.id, ids));
    removed += ids.length;
    log(`Merged duplicate: ${keep.company} · ${keep.role} (removed ${ids.length} extra cop${ids.length === 1 ? "y" : "ies"})`);
  }
  return removed;
}

export async function storeJobs(raw: RawJob[], filter: JobFilter, log: Log): Promise<number> {
  const db = await getDb();
  await mergeSavedDuplicates(log);
  const existing = await db
    .select({
      id: schema.jobs.id,
      company: schema.jobs.company,
      role: schema.jobs.role,
      link: schema.jobs.link,
      source: schema.jobs.source,
      sourceId: schema.jobs.sourceId,
    })
    .from(schema.jobs);
  const dismissed = await dismissedKeys();
  const onBoard = dedupeJobs(raw, existing);
  const unique = dedupeJobs(onBoard, [], dismissed);
  const fresh = unique.filter((j) => !rejectReason(j, filter));
  const taken = new Set(existing.map((j) => j.id));

  for (const j of fresh) {
    // A post signed only by a handle ("u/name", "@name") names no company to look up.
    const cId = /^(u\/|@)/.test(j.company) ? null : await upsertCompany(j.company, j.company_);
    await db.insert(schema.jobs).values({
      id: jobId(j.company, j.role, taken),
      company: j.company,
      role: j.role,
      link: j.link,
      status: "Found",
      source: j.source,
      sourceId: j.sourceId,
      kind: j.kind ?? "listing",
      alsoOn: j.alsoOn ?? [],
      pay: j.pay || null,
      tier: j.tier || null,
      mode: j.mode || null,
      location: j.location || null,
      description: j.description || null,
      found: today(),
      postedAt: parsePosted(j.posted),
      companyId: cId,
    });
    if (j.recruiter?.name && cId) {
      const contactId = slug(`${j.recruiter.name} ${j.company}`, "contact");
      await db
        .insert(schema.contacts)
        .values({
          id: contactId,
          companyId: cId,
          company: j.company,
          name: j.recruiter.name,
          title: "Job poster",
          linkedin: j.recruiter.linkedin || null,
          source: j.source,
        })
        .onConflictDoNothing();
    }
  }
  log(
    `Saved ${fresh.length} new jobs (skipped ${raw.length - onBoard.length} already on your board or found twice` +
      `${onBoard.length > unique.length ? `, ${onBoard.length - unique.length} you deleted before` : ""})`,
  );
  if (unique.length > fresh.length) {
    log(`Filtered out ${unique.length - fresh.length} jobs (pay or location)`);
  }
  return fresh.length;
}

// ---------- score ----------

export async function scoreNewJobs(
  profile: Profile,
  settings: AppSettings,
  log: Log,
  limit = 60,
): Promise<number> {
  const db = await getDb();
  const pending = await db
    .select()
    .from(schema.jobs)
    .where(and(isNull(schema.jobs.fit), eq(schema.jobs.status, "Found")))
    .limit(limit);
  if (!pending.length) return 0;

  let scored = 0;
  for (const batch of chunk(pending, 10)) {
    try {
      const results = await scoreJobs(
        profile,
        batch.map((j) => ({
          id: j.id,
          company: j.company,
          role: j.role,
          location: j.location,
          pay: j.pay,
          description: j.description ?? j.notes,
        })),
        {
          titles: searchTitles(settings.search),
          locations: settings.search.locations.map((l) => l.label),
          minPay: describeMinPay(settings.search.minPay),
          homeCity: settings.search.homeCity.trim(),
          homePlaces: homePlaces(settings.search),
        },
      );
      for (const r of results) {
        const job = batch.find((j) => j.id === r.id);
        if (!job) continue;
        await db
          .update(schema.jobs)
          .set({
            fit: r.fit,
            score: r.score,
            flags: [...new Set([...(job.flags ?? []), ...r.flags])],
            notes: job.notes || r.reason,
            status: r.fit === "Skip" ? "Skipped" : job.status,
            updatedAt: new Date(),
          })
          .where(eq(schema.jobs.id, r.id));
        scored++;
      }
    } catch (err) {
      log(`Scoring failed for a batch: ${errorMessage(err)}`);
      break;
    }
  }
  log(`Scored ${scored} jobs`);
  return scored;
}

// ---------- enrich ----------

async function saveSiteContacts(company: Company, site: SiteContacts | undefined) {
  const db = await getDb();
  const domain = domainOf(company.website);
  const ranked = rankEmails(site?.emails ?? [], domain);
  const inbox = ranked.find((e) => e.kind === "hiring") ?? ranked.find((e) => e.kind === "generic");
  const people = ranked.filter((e) => e.kind === "person").slice(0, 2);
  const phone = site?.phones?.[0] ?? null;

  if (inbox) {
    await db
      .insert(schema.contacts)
      .values({
        id: slug(`hiring ${company.name}`, "contact"),
        companyId: company.id,
        company: company.name,
        name: `${company.name} hiring team`,
        title: inbox.kind === "hiring" ? "Careers inbox" : "General inbox",
        email: inbox.email,
        emailStatus: "site",
        phone,
        source: "Website",
      })
      .onConflictDoNothing();
  }
  for (const p of people) {
    const local = p.email.split("@")[0];
    const name = local
      .split(/[._-]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    await db
      .insert(schema.contacts)
      .values({
        id: slug(`${local} ${company.name}`, "contact"),
        companyId: company.id,
        company: company.name,
        name,
        email: p.email,
        emailStatus: "site",
        source: "Website",
        notes: "Name taken from the email address; check it before writing.",
      })
      .onConflictDoNothing();
  }
  return { emails: ranked.length, phone };
}

async function saveApollo(company: Company, log: Log) {
  const domain = domainOf(company.website);
  if (!domain || !(await hasApollo())) return;
  const db = await getDb();
  try {
    const info = await apolloCompany(domain);
    if (info) {
      await db
        .update(schema.companies)
        .set({
          size: company.size || info.size || null,
          industry: company.industry || info.industry || null,
          about: company.about || info.about || null,
          address: company.address || info.address || null,
          phone: company.phone || info.phone || null,
          linkedin: company.linkedin || info.linkedin || null,
          updatedAt: new Date(),
        })
        .where(eq(schema.companies.id, company.id));
    }
    for (const p of await apolloPeople(domain)) {
      await db
        .insert(schema.contacts)
        .values({
          id: slug(`${p.name} ${company.name}`, "contact"),
          companyId: company.id,
          company: company.name,
          name: p.name,
          title: p.title || null,
          email: p.email || null,
          emailStatus: p.email ? "verified" : null,
          phone: p.phone || null,
          linkedin: p.linkedin || null,
          source: "Apollo",
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    log(`Apollo lookup for ${company.name}: ${errorMessage(err)}`);
  }
}

/** Looks up website, public emails, phone and people for the given companies. */
export async function enrichCompanies(ids: string[], log: Log): Promise<number> {
  if (!ids.length) return 0;
  const db = await getDb();
  let companies = await db.select().from(schema.companies).where(inArray(schema.companies.id, ids));

  const missingSite = companies.filter((c) => !c.website);
  if (missingSite.length) {
    try {
      const sites = await findWebsites(missingSite.map((c) => c.name));
      for (const c of missingSite) {
        const website = sites.get(c.name);
        if (website) {
          await db
            .update(schema.companies)
            .set({ website, updatedAt: new Date() })
            .where(eq(schema.companies.id, c.id));
        }
      }
      companies = await db.select().from(schema.companies).where(inArray(schema.companies.id, ids));
    } catch (err) {
      log(`Website lookup: ${errorMessage(err)}`);
      if (err instanceof BudgetError) return 0;
    }
  }

  const withSite = companies.filter((c) => c.website);
  let sites = new Map<string, SiteContacts>();
  try {
    sites = await scrapeSites(withSite.map((c) => c.website!));
  } catch (err) {
    log(`Contact lookup: ${errorMessage(err)}`);
    if (err instanceof BudgetError) return 0;
  }

  let enriched = 0;
  for (const c of companies) {
    const site = sites.get(domainOf(c.website) ?? "");
    const { phone } = await saveSiteContacts(c, site);
    await saveApollo(c, log);
    await db
      .update(schema.companies)
      .set({ phone: c.phone || phone, enrichedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.companies.id, c.id));
    enriched++;
  }
  log(`Looked up ${enriched} companies (${withSite.length} had a website)`);
  return enriched;
}

/** Companies behind Strong-fit open jobs that have not been looked up yet. */
export async function companiesToEnrich(limit: number): Promise<string[]> {
  const db = await getDb();
  const strong = await db
    .select({ companyId: schema.jobs.companyId, score: schema.jobs.score })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.fit, "Strong"), inArray(schema.jobs.status, ["Found", "Drafted"])));
  const wanted = [...new Set(
    strong
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map((j) => j.companyId)
      .filter((id): id is string => !!id),
  )];
  if (!wanted.length) return [];
  const pending = await db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(and(inArray(schema.companies.id, wanted), isNull(schema.companies.enrichedAt)));
  const pendingIds = new Set(pending.map((c) => c.id));
  return wanted.filter((id) => pendingIds.has(id)).slice(0, limit);
}

// ---------- draft ----------

/** Best person to email at a company: verified person, then hiring inbox, then any. */
export async function bestContact(cId: string | null) {
  if (!cId) return null;
  const db = await getDb();
  const all = await db.select().from(schema.contacts).where(eq(schema.contacts.companyId, cId));
  const usable = all.filter((c) => c.email && !c.optedOut && c.status !== "Do not contact");
  const rank = (c: (typeof usable)[number]) =>
    c.emailStatus === "verified" ? 0 : /careers|hiring/i.test(c.title ?? "") ? 1 : c.emailStatus === "site" ? 2 : 3;
  return usable.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * Reads up on the company, then writes the cover letter (also the email) and
 * CV selection for one job. Site text is cached on the company for a month.
 */
export async function writeApplication(
  job: Job,
  profile: Profile,
  contact: { name?: string | null; title?: string | null } | null,
): Promise<OutreachDraft> {
  const db = await getDb();
  const [company] = job.companyId
    ? await db.select().from(schema.companies).where(eq(schema.companies.id, job.companyId))
    : [];
  const research = await researchCompany(
    { company: job.company, link: job.link, description: job.description },
    company ?? null,
  );
  if (company && research.fresh) {
    await db
      .update(schema.companies)
      .set({ research: research.fresh, researchedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.companies.id, company.id));
  }
  return draftApplication(
    profile,
    {
      company: job.company,
      role: job.role,
      location: job.location,
      mode: job.mode,
      link: job.link,
      description: job.description ?? job.notes,
      research: research.text,
    },
    contact,
  );
}

/**
 * Writes the cover letter and CV selection for one job. Puts it in the Outbox
 * when there is someone to send it to; otherwise the draft stays on the job
 * for a portal application. An unsent Outbox email is replaced by a rewrite.
 */
export async function draftForJob(job: Job, profile: Profile): Promise<{ queued: boolean }> {
  const db = await getDb();
  const contact = await bestContact(job.companyId);
  const draft = await writeApplication(job, profile, contact);

  await db
    .update(schema.jobs)
    .set({
      // A cover letter the user already has is never overwritten.
      cover: job.cover || draft.body,
      // The pitch describes the letter on the job, so it is replaced only with it.
      pitch: job.cover ? job.pitch : draft.pitch,
      cvVariant: draft.cvVariant,
      status: job.status === "Found" ? "Drafted" : job.status,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, job.id));

  if (!contact?.email) return { queued: false };
  const existing = await db
    .select({ id: schema.outbox.id, status: schema.outbox.status, followUpOf: schema.outbox.followUpOf })
    .from(schema.outbox)
    .where(eq(schema.outbox.jobId, job.id));
  if (existing.length) {
    // Keep the Outbox in step with a rewritten letter, while nothing has gone out.
    const unsent = existing.filter((o) => !o.followUpOf && ["queued", "approved", "failed"].includes(o.status));
    if (!job.cover && unsent.length === existing.length) {
      for (const o of unsent) {
        await db
          .update(schema.outbox)
          .set({ subject: draft.subject, body: draft.body, cvVariant: draft.cvVariant, updatedAt: new Date() })
          .where(eq(schema.outbox.id, o.id));
      }
    }
    return { queued: false };
  }

  await db.insert(schema.outbox).values({
    id: uid(),
    jobId: job.id,
    contactId: contact.id,
    companyId: job.companyId,
    to: contact.email,
    subject: draft.subject,
    body: draft.body,
    cvVariant: draft.cvVariant,
  });
  return { queued: true };
}

export async function draftStrongJobs(profile: Profile, limit: number, log: Log): Promise<number> {
  const db = await getDb();
  const candidates = await db
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.fit, "Strong"),
        inArray(schema.jobs.status, ["Found", "Drafted"]),
        isNull(schema.jobs.cvVariant),
      ),
    );
  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  let drafted = 0;
  let queued = 0;
  for (const job of candidates.slice(0, limit)) {
    try {
      const r = await draftForJob(job, profile);
      drafted++;
      if (r.queued) queued++;
    } catch (err) {
      log(`Draft for ${job.company}: ${errorMessage(err)}`);
    }
  }
  if (drafted) log(`Wrote ${drafted} applications (${queued} waiting in Outbox)`);
  return drafted;
}

// ---------- replies and follow-ups ----------

export async function checkReplies(log: Log): Promise<number> {
  const db = await getDb();
  const waiting = await db
    .select()
    .from(schema.outbox)
    .where(and(eq(schema.outbox.status, "sent"), isNull(schema.outbox.repliedAt)));
  if (!waiting.length) return 0;

  let replied: Set<string>;
  try {
    replied = await findReplies(
      waiting.filter((w) => w.sentAt).map((w) => ({ email: w.to, since: w.sentAt! })),
    );
  } catch (err) {
    log(`Reply check: ${errorMessage(err)}`);
    return 0;
  }

  let count = 0;
  for (const item of waiting) {
    if (!replied.has(item.to.toLowerCase())) continue;
    const now = new Date();
    await db
      .update(schema.outbox)
      .set({ repliedAt: now, updatedAt: now })
      .where(eq(schema.outbox.id, item.id));
    if (item.jobId) {
      await db
        .update(schema.jobs)
        .set({ status: "Replied", followUp: null, updatedAt: now })
        .where(and(eq(schema.jobs.id, item.jobId), eq(schema.jobs.status, "Applied")));
    }
    if (item.contactId) {
      await db
        .update(schema.contacts)
        .set({ status: "Replied", nextFollowUp: null, updatedAt: now })
        .where(eq(schema.contacts.id, item.contactId));
    }
    count++;
  }
  if (count) log(`${count} new replies found in Gmail`);
  return count;
}

export async function draftFollowUps(
  profile: Profile,
  settings: AppSettings,
  log: Log,
  limit = 5,
): Promise<number> {
  const db = await getDb();
  const all = await db.select().from(schema.outbox);
  const hasFollowUp = new Set(all.map((o) => o.followUpOf).filter(Boolean));
  const due = all.filter(
    (o) =>
      o.status === "sent" &&
      !o.followUpOf &&
      !o.repliedAt &&
      o.sentAt &&
      !hasFollowUp.has(o.id) &&
      daysBetween(o.sentAt.toISOString()) >= settings.outreach.followUpDays,
  );

  let drafted = 0;
  for (const o of due.slice(0, limit)) {
    const [job] = o.jobId
      ? await db.select().from(schema.jobs).where(eq(schema.jobs.id, o.jobId))
      : [];
    if (job && ["Rejected", "Skipped", "Offer", "Interview", "Replied"].includes(job.status)) continue;
    try {
      const f = await draftFollowUp(profile, {
        subject: o.subject,
        body: o.body,
        company: job?.company ?? "the company",
        role: job?.role ?? "the role",
      });
      await db.insert(schema.outbox).values({
        id: uid(),
        jobId: o.jobId,
        contactId: o.contactId,
        companyId: o.companyId,
        to: o.to,
        subject: f.subject,
        body: f.body,
        followUpOf: o.id,
      });
      drafted++;
    } catch (err) {
      log(`Follow-up for ${o.to}: ${errorMessage(err)}`);
    }
  }
  if (drafted) log(`Wrote ${drafted} follow-ups`);
  return drafted;
}

export { profileIsReady };
