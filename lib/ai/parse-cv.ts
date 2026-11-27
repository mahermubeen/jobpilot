import type { Profile } from "@/lib/cv/types";
import { completeJson } from "./provider";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const strings = (v: unknown) => arr<string>(v).map(str).filter(Boolean);

const toLinks = (v: unknown) => arr<{ label: string; url: string }>(v).map((l) => ({ label: str(l.label), url: str(l.url) })).filter((l) => l.url);

const toExperience = (v: unknown) =>
  arr<Profile["experience"][number]>(v).map((e) => ({
    company: str(e.company),
    title: str(e.title),
    location: str(e.location),
    start: str(e.start),
    end: str(e.end),
    bullets: strings(e.bullets),
  }));

const toProjects = (v: unknown) =>
  arr<Profile["projects"][number]>(v).map((p) => ({ name: str(p.name), description: str(p.description), tech: str(p.tech), url: str(p.url) }));

const toSkills = (v: unknown) =>
  arr<Profile["skills"][number]>(v)
    .map((s) => ({ category: str(s.category), items: strings(s.items) }))
    .filter((s) => s.items.length);

const toEducation = (v: unknown) =>
  arr<Profile["education"][number]>(v).map((e) => ({ school: str(e.school), degree: str(e.degree), start: str(e.start), end: str(e.end) }));

/** The model's JSON as a Profile: every field checked, nothing trusted as-is. */
export function toProfile(raw: Partial<Profile>): Profile {
  return {
    name: str(raw.name),
    headline: str(raw.headline),
    email: str(raw.email),
    phone: str(raw.phone),
    location: str(raw.location),
    links: toLinks(raw.links),
    summary: str(raw.summary),
    experience: toExperience(raw.experience),
    projects: toProjects(raw.projects),
    skills: toSkills(raw.skills),
    education: toEducation(raw.education),
  };
}

/** Turns the text of an uploaded CV into the structured master profile. */
export async function parseCv(cvText: string): Promise<Profile> {
  const prompt = `Convert this CV into JSON. Copy facts exactly as written; do not improve, summarise or invent anything. Use an empty string or empty list when something is missing.

<cv>
${cvText.slice(0, 40000)}
</cv>

Reply with only this JSON shape:
{"name": "", "headline": "", "email": "", "phone": "", "location": "", "links": [{"label": "LinkedIn", "url": "https://..."}], "summary": "", "experience": [{"company": "", "title": "", "location": "", "start": "Jan 2025", "end": "Present", "bullets": ["full bullet text"]}], "projects": [{"name": "", "description": "", "tech": "", "url": ""}], "skills": [{"category": "Frontend", "items": ["React.js"]}], "education": [{"school": "", "degree": "", "start": "", "end": ""}]}

"headline" is the job title line under the name if there is one, otherwise the most recent job title. Links need full URLs starting with https://.`;
  return toProfile(await completeJson<Partial<Profile>>(prompt, "write"));
}
