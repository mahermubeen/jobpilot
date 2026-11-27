import { getSecrets } from "@/lib/settings";

/**
 * Optional Apollo.io lookups (needs the user's own Apollo API key).
 * Search is free on Apollo; revealing an email spends one Apollo credit, so
 * reveals are limited to `maxReveals` people per company.
 */

const BASE = "https://api.apollo.io/api/v1";
const TITLES = [
  "founder", "co-founder", "ceo", "cto", "vp engineering", "head of engineering",
  "engineering manager", "technical recruiter", "recruiter", "talent acquisition",
  "head of people",
];

export type ApolloPerson = {
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedin: string;
};

export type ApolloCompany = {
  size: string;
  industry: string;
  about: string;
  address: string;
  phone: string;
  linkedin: string;
};

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const { apolloKey } = await getSecrets();
  if (!apolloKey) throw new Error("No Apollo API key saved.");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": apolloKey,
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`Apollo ${res.status}: ${detail || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function hasApollo(): Promise<boolean> {
  return !!(await getSecrets()).apolloKey;
}

const text = (v: unknown) => (v == null ? "" : String(v));

export async function apolloCompany(domain: string): Promise<ApolloCompany | null> {
  const data = await call<{ organization?: Record<string, unknown> }>(
    `/organizations/enrich?domain=${encodeURIComponent(domain)}`,
    { method: "GET" },
  );
  const o = data.organization;
  if (!o) return null;
  return {
    size: text(o.estimated_num_employees),
    industry: text(o.industry),
    about: text(o.short_description),
    address: text(o.raw_address),
    phone: text(o.phone),
    linkedin: text(o.linkedin_url),
  };
}

const isHiddenEmail = (email: string) => /not_unlocked|domain\.com$/.test(email);

function toPerson(m: Record<string, unknown>): ApolloPerson {
  const email = text(m.email);
  return {
    name: text(m.name) || [text(m.first_name), text(m.last_name)].filter(Boolean).join(" "),
    title: text(m.title),
    email: isHiddenEmail(email) ? "" : email,
    phone: text((m.organization as Record<string, unknown> | undefined)?.phone),
    linkedin: text(m.linkedin_url),
  };
}

/** Reveals one person (one Apollo credit). A failed reveal returns null so the rest of the lookup goes on. */
async function revealPerson(id: string | number): Promise<ApolloPerson | null> {
  try {
    const match = await call<{ person?: Record<string, unknown> }>("/people/match", {
      method: "POST",
      body: JSON.stringify({ id, reveal_personal_emails: false }),
    });
    return toPerson(match.person ?? {});
  } catch {
    return null;
  }
}

export async function apolloPeople(domain: string, maxReveals = 2): Promise<ApolloPerson[]> {
  const search = await call<{ people?: Record<string, unknown>[] }>(
    "/mixed_people/api_search",
    {
      method: "POST",
      body: JSON.stringify({
        q_organization_domains_list: [domain],
        person_titles: TITLES,
        per_page: 5,
      }),
    },
  );
  const ids = (search.people ?? [])
    .slice(0, maxReveals)
    .map((p) => p.id)
    .filter((id): id is string | number => (typeof id === "string" || typeof id === "number") && !!id);
  // At most `maxReveals` (2 by default) calls, so running them together is safe.
  const people = await Promise.all(ids.map(revealPerson));
  return people.filter((p): p is ApolloPerson => !!p?.name);
}

export async function testApollo(): Promise<string> {
  await call("/organizations/enrich?domain=apollo.io", { method: "GET" });
  return "Apollo key works.";
}
