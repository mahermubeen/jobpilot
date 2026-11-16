import type { CvVariant, Profile } from "./types";

const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Keeps a tailored CV honest: bullets, skills and projects are only kept when
 * they exist in the master CV. Anything the AI added or reworded is dropped,
 * and a job with no surviving bullets falls back to its master bullets.
 */
export function sanitizeVariant(
  profile: Profile,
  raw: Partial<CvVariant> | null | undefined,
): CvVariant {
  const v = raw ?? {};

  const experience = profile.experience.map((job) => {
    const master = new Map(job.bullets.map((b) => [key(b), b]));
    const wanted =
      v.experience?.find((e) => key(e.company ?? "") === key(job.company))
        ?.bullets ?? [];
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const b of wanted) {
      const original = master.get(key(String(b)));
      if (original && !seen.has(original)) {
        seen.add(original);
        kept.push(original);
      }
    }
    return { company: job.company, bullets: kept.length ? kept : job.bullets };
  });

  const masterSkills = new Map<string, string>();
  for (const group of profile.skills)
    for (const item of group.items) masterSkills.set(key(item), item);
  const usedSkills = new Set<string>();
  const skills = (v.skills ?? [])
    .map((group) => ({
      category: String(group.category ?? "").slice(0, 40),
      items: (group.items ?? [])
        .map((item) => masterSkills.get(key(String(item))))
        .filter((item): item is string => {
          if (!item || usedSkills.has(item)) return false;
          usedSkills.add(item);
          return true;
        }),
    }))
    .filter((group) => group.category && group.items.length);

  const masterProjects = new Map(profile.projects.map((p) => [key(p.name), p.name]));
  const projects = [
    ...new Set(
      (v.projects ?? [])
        .map((name) => masterProjects.get(key(String(name))))
        .filter((name): name is string => !!name),
    ),
  ];

  return {
    headline: String(v.headline || profile.headline).slice(0, 140),
    summary: String(v.summary || profile.summary).slice(0, 700),
    experience,
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
