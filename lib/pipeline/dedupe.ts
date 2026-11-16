import type { RawJob } from "@/lib/sources/types";
import { norm, slug } from "@/lib/util";

const SUFFIX = /\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|pvt|private|plc|sa|bv|ag)\b\.?/gi;

/** "Acme, Inc." and "ACME" are the same company. */
export const companyKey = (name: string) => norm(name.replace(SUFFIX, " "));

export const companyId = (name: string) => slug(companyKey(name), "company");

export const roleKey = (company: string, role: string) => `${companyKey(company)}|${norm(role)}`;

export const linkKey = (link: string | null | undefined) =>
  (link ?? "").split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();

export type KnownJob = {
  company: string;
  role: string;
  link: string | null;
  source: string | null;
  sourceId: string | null;
};

/**
 * Drops postings already stored (same source id, same link, or same company
 * and role) and repeats inside the new batch. The first occurrence wins.
 */
export function dedupeJobs(incoming: RawJob[], existing: KnownJob[]): RawJob[] {
  const ids = new Set<string>();
  const links = new Set<string>();
  const roles = new Set<string>();
  for (const j of existing) {
    if (j.source && j.sourceId) ids.add(`${j.source}|${j.sourceId}`);
    if (j.link) links.add(linkKey(j.link));
    roles.add(roleKey(j.company, j.role));
  }

  const fresh: RawJob[] = [];
  for (const j of incoming) {
    const id = `${j.source}|${j.sourceId}`;
    const link = linkKey(j.link);
    const role = roleKey(j.company, j.role);
    if (ids.has(id) || (link && links.has(link)) || roles.has(role)) continue;
    ids.add(id);
    if (link) links.add(link);
    roles.add(role);
    fresh.push(j);
  }
  return fresh;
}

/** A readable, unique id for a new job row. */
export function jobId(company: string, role: string, taken: Set<string>): string {
  const base = slug(`${company} ${role}`, "job");
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}
