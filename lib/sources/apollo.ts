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

export async function apolloCompany(domain: string): Promise<ApolloCompany | null> {
  const data = await call<{ organization?: Record<string, unknown> }>(
    `/organizations/enrich?domain=${encodeURIComponent(domain)}`,
    { method: "GET" },
  );
  const o = data.organization;
  if (!o) return null;
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    size: s(o.estimated_num_employees),
    industry: s(o.industry),
    about: s(o.short_description),
    address: s(o.raw_address),
    phone: s(o.phone),
    linkedin: s(o.linkedin_url),
  };
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
  const people: ApolloPerson[] = [];
  for (const p of (search.people ?? []).slice(0, maxReveals)) {
    if (!p.id) continue;
    try {
      const match = await call<{ person?: Record<string, unknown> }>("/people/match", {
        method: "POST",
        body: JSON.stringify({ id: p.id, reveal_personal_emails: false }),
      });
      const m = match.person ?? {};
      const s = (v: unknown) => (v == null ? "" : String(v));
      const email = s(m.email);
      people.push({
        name: s(m.name) || [s(m.first_name), s(m.last_name)].filter(Boolean).join(" "),
        title: s(m.title),
        email: /not_unlocked|domain\.com$/.test(email) ? "" : email,
        phone: s((m.organization as Record<string, unknown> | undefined)?.phone),
        linkedin: s(m.linkedin_url),
      });
    } catch {
      // A failed reveal should not stop the rest of the company's lookup.
    }
  }
  return people.filter((p) => p.name);
}

export async function testApollo(): Promise<string> {
  await call("/organizations/enrich?domain=apollo.io", { method: "GET" });
  return "Apollo key works.";
}
