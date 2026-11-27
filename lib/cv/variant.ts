import type { CvVariant, Profile } from "./types";

const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

type Wanted = Partial<CvVariant>;

/** Master bullets the variant picked for one job, in its order, each once; the master list when none survive. */
function keptBullets(job: Profile["experience"][number], wanted: Wanted): string[] {
  const master = new Map(job.bullets.map((b) => [key(b), b]));
  const picked = wanted.experience?.find((e) => key(e.company ?? "") === key(job.company))?.bullets ?? [];
  const kept = [...new Set(picked.map((b) => master.get(key(String(b)))).filter((b): b is string => !!b))];
  return kept.length ? kept : job.bullets;
}

/** Skill groups using only master skills, each skill once across all groups; empty groups dropped. */
function keptSkills(profile: Profile, wanted: Wanted): CvVariant["skills"] {
  const masterSkills = new Map(profile.skills.flatMap((group) => group.items.map((item) => [key(item), item] as const)));
  const used = new Set<string>();
  const once = (item: string | undefined): item is string => {
    if (!item || used.has(item)) return false;
    used.add(item);
    return true;
  };
  return (wanted.skills ?? [])
    .map((group) => ({
      category: String(group.category ?? "").slice(0, 40),
      items: (group.items ?? []).map((item) => masterSkills.get(key(String(item)))).filter(once),
    }))
    .filter((group) => group.category && group.items.length);
}

function keptProjects(profile: Profile, wanted: Wanted): string[] {
  const masterProjects = new Map(profile.projects.map((p) => [key(p.name), p.name]));
  return [...new Set((wanted.projects ?? []).map((name) => masterProjects.get(key(String(name)))).filter((name): name is string => !!name))];
}

/**
 * Keeps a tailored CV honest: bullets, skills and projects are only kept when
 * they exist in the master CV. Anything the AI added or reworded is dropped,
 * and a job with no surviving bullets falls back to its master bullets.
 */
export function sanitizeVariant(profile: Profile, raw: Partial<CvVariant> | null | undefined): CvVariant {
  const v = raw ?? {};
  const skills = keptSkills(profile, v);
  const projects = keptProjects(profile, v);
  return {
    headline: String(v.headline || profile.headline).slice(0, 140),
    summary: String(v.summary || profile.summary).slice(0, 700),
    experience: profile.experience.map((job) => ({ company: job.company, bullets: keptBullets(job, v) })),
    skills: skills.length ? skills : profile.skills,
    projects: projects.length ? projects : profile.projects.map((p) => p.name),
  };
}

export function defaultVariant(profile: Profile): CvVariant {
  return sanitizeVariant(profile, null);
}

export function cvFileName(profile: Profile, role?: string, company?: string) {
  const clean = (s: string) =>
    s
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  return [clean(profile.name || "CV"), role && clean(role), company && clean(company)]
    .filter(Boolean)
    .join("-") + ".pdf";
}
