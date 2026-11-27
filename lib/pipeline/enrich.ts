import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Company } from "@/lib/db/schema";
import { apolloCompany, apolloPeople, hasApollo, type ApolloCompany, type ApolloPerson } from "@/lib/sources/apollo";
import { BudgetError } from "@/lib/sources/apify";
import { findWebsites, type RankedEmail, rankEmails, scrapeSites } from "@/lib/sources/contacts";
import { pool } from "@/lib/sources/net";
import type { SiteContacts } from "@/lib/sources/types";
import { domainOf, errorMessage, slug } from "@/lib/util";
import type { Log } from "./find";

type Db = Awaited<ReturnType<typeof getDb>>;
type ContactInsert = typeof schema.contacts.$inferInsert;

/** Named people taken from a company site per company. */
const PEOPLE_PER_SITE = 2;
/** Companies looked up at once: each may call Apollo, which rate-limits. */
const ENRICH_CONCURRENCY = 2;

/** "jane.doe" -> "Jane Doe". */
const nameFromLocalPart = (local: string) =>
  local
    .split(/[._-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

function inboxContact(company: Company, inbox: RankedEmail, phone: string | null): ContactInsert {
  return {
    id: slug(`hiring ${company.name}`, "contact"),
    companyId: company.id,
    company: company.name,
    name: `${company.name} hiring team`,
    title: inbox.kind === "hiring" ? "Careers inbox" : "General inbox",
    email: inbox.email,
    emailStatus: "site",
    phone,
    source: "Website",
  };
}

function personContact(company: Company, person: RankedEmail): ContactInsert {
  const local = person.email.split("@")[0];
  return {
    id: slug(`${local} ${company.name}`, "contact"),
    companyId: company.id,
    company: company.name,
    name: nameFromLocalPart(local),
    email: person.email,
    emailStatus: "site",
    source: "Website",
    notes: "Name taken from the email address; check it before writing.",
  };
}

/** Saves the hiring (or general) inbox and up to two named people found on the company site. */
async function saveSiteContacts(db: Db, company: Company, site: SiteContacts | undefined) {
  const ranked = rankEmails(site?.emails ?? [], domainOf(company.website));
  const inbox = ranked.find((e) => e.kind === "hiring") ?? ranked.find((e) => e.kind === "generic");
  const phone = site?.phones?.[0] ?? null;
  const people = ranked.filter((e) => e.kind === "person").slice(0, PEOPLE_PER_SITE);
  const rows = [...(inbox ? [inboxContact(company, inbox, phone)] : []), ...people.map((p) => personContact(company, p))];
  if (rows.length) await db.insert(schema.contacts).values(rows).onConflictDoNothing();
  return { emails: ranked.length, phone };
}

const APOLLO_FIELDS = ["size", "industry", "about", "address", "phone", "linkedin"] as const;

/** Company details Apollo knows, only where ours are empty. */
const apolloGaps = (company: Company, info: ApolloCompany) =>
  Object.fromEntries(APOLLO_FIELDS.map((k) => [k, company[k] || info[k] || null])) as Record<(typeof APOLLO_FIELDS)[number], string | null>;

function apolloContact(company: Company, p: ApolloPerson): ContactInsert {
  return {
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
  };
}

async function saveApollo(db: Db, company: Company, log: Log) {
  const domain = domainOf(company.website);
  if (!domain || !(await hasApollo())) return;
  try {
    const info = await apolloCompany(domain);
    if (info) {
      await db.update(schema.companies).set({ ...apolloGaps(company, info), updatedAt: new Date() }).where(eq(schema.companies.id, company.id));
    }
    const people = await apolloPeople(domain);
    if (people.length) await db.insert(schema.contacts).values(people.map((p) => apolloContact(company, p))).onConflictDoNothing();
  } catch (err) {
    log(`Apollo lookup for ${company.name}: ${errorMessage(err)}`);
  }
}

const companiesById = (db: Db, ids: string[]) => db.select().from(schema.companies).where(inArray(schema.companies.id, ids));

/** Fills in missing websites. Returns false when the Apify budget ran out (stop the lookup). */
async function addMissingWebsites(db: Db, companies: Company[], log: Log): Promise<boolean> {
  const missing = companies.filter((c) => !c.website);
  if (!missing.length) return true;
  try {
    const sites = await findWebsites(missing.map((c) => c.name));
    const found = missing.flatMap((c) => {
      const website = sites.get(c.name);
      return website ? [{ id: c.id, website }] : [];
    });
    await Promise.all(found.map(({ id, website }) => db.update(schema.companies).set({ website, updatedAt: new Date() }).where(eq(schema.companies.id, id))));
    return true;
  } catch (err) {
    log(`Website lookup: ${errorMessage(err)}`);
    return !(err instanceof BudgetError);
  }
}

/** Public emails and phones from each company site, by domain. Null when the Apify budget ran out. */
async function scrapeCompanySites(withSite: Company[], log: Log): Promise<Map<string, SiteContacts> | null> {
  try {
    return await scrapeSites(withSite.map((c) => c.website!));
  } catch (err) {
    log(`Contact lookup: ${errorMessage(err)}`);
    return err instanceof BudgetError ? null : new Map();
  }
}

async function enrichOne(db: Db, c: Company, sites: Map<string, SiteContacts>, log: Log) {
  const { phone } = await saveSiteContacts(db, c, sites.get(domainOf(c.website) ?? ""));
  await saveApollo(db, c, log);
  await db
    .update(schema.companies)
    .set({ phone: c.phone || phone, enrichedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.companies.id, c.id));
}

/** Looks up website, public emails, phone and people for the given companies. */
export async function enrichCompanies(ids: string[], log: Log): Promise<number> {
  if (!ids.length) return 0;
  const db = await getDb();
  const before = await companiesById(db, ids);
  if (!(await addMissingWebsites(db, before, log))) return 0;
  const companies = before.some((c) => !c.website) ? await companiesById(db, ids) : before;

  const withSite = companies.filter((c) => c.website);
  const sites = await scrapeCompanySites(withSite, log);
  if (!sites) return 0;

  await pool(companies, ENRICH_CONCURRENCY, (c) => enrichOne(db, c, sites, log));
  log(`Looked up ${companies.length} companies (${withSite.length} had a website)`);
  return companies.length;
}

/** Companies behind Strong-fit open jobs that have not been looked up yet. */
export async function companiesToEnrich(limit: number): Promise<string[]> {
  const db = await getDb();
  const strong = await db
    .select({ companyId: schema.jobs.companyId, score: schema.jobs.score })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.fit, "Strong"), inArray(schema.jobs.status, ["Found", "Drafted"])));
  const wanted = [
    ...new Set(
      strong
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .map((j) => j.companyId)
        .filter((id): id is string => !!id),
    ),
  ];
  if (!wanted.length) return [];
  const pending = await db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(and(inArray(schema.companies.id, wanted), isNull(schema.companies.enrichedAt)));
  const pendingIds = new Set(pending.map((c) => c.id));
  return wanted.filter((id) => pendingIds.has(id)).slice(0, limit);
}
