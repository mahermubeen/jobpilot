import type { Profile } from "@/lib/cv/types";

/** The candidate's master CV as plain text for prompts. */
export function profileText(p: Profile): string {
  const exp = p.experience
    .map(
      (e) =>
        `${e.title} at ${e.company} (${e.start} to ${e.end}, ${e.location})\n` +
        e.bullets.map((b) => `- ${b}`).join("\n"),
    )
    .join("\n\n");
  const skills = p.skills.map((s) => `${s.category}: ${s.items.join(", ")}`).join("\n");
  const projects = p.projects
    .map((x) => `${x.name}: ${[x.description, x.tech].filter(Boolean).join(" | ")}`)
    .join("\n");
  const edu = p.education.map((e) => `${e.degree}, ${e.school} (${e.start} to ${e.end})`).join("\n");
  return [
    `Name: ${p.name}`,
    `Headline: ${p.headline}`,
    `Based in: ${p.location}`,
    p.summary && `Summary: ${p.summary}`,
    `Experience:\n${exp}`,
    projects && `Projects:\n${projects}`,
    `Skills:\n${skills}`,
    edu && `Education:\n${edu}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
