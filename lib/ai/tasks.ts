import type { Profile } from "@/lib/cv/types";
import { completeJson } from "./provider";

/**
 * Every AI task, each in its own file with its prompt. Import from here.
 * Model output is parsed and checked in each file before it is returned.
 */
export { type Fit, type JobForScoring, type JobScore, scoreJobs } from "./score";
export { draftApplication, draftFollowUp, type JobForDraft, letterProblem, type OutreachDraft } from "./letter";
export { answerFormFields, type AnswerRequest, estimateMarketSalary, isOpenQuestion, type JobForAnswers } from "./form-answers";
export { parseCv } from "./parse-cv";

/**
 * Other names employers use for the candidate's target roles, so searches
 * catch postings worded differently. Asked again only when titles or CV change.
 */
export async function expandTitles(profile: Profile, titles: string[], removed: string[] = []): Promise<string[]> {
  if (!titles.length) return [];
  const recent = profile.experience.slice(0, 4).map((e) => e.title).filter(Boolean);
  const skills = profile.skills.flatMap((s) => s.items).slice(0, 30);
  const prompt = `A job seeker searches job boards with these titles:
${titles.map((t) => `- ${t}`).join("\n")}

Their headline: ${profile.headline || "not given"}
Recent job titles: ${recent.join("; ") || "not given"}
Main skills: ${skills.join(", ") || "not given"}

List 8 to 15 other job titles employers commonly use for the SAME kind of role and level, so a search does not miss postings worded differently. Include:
- spelling and wording variants (for example "Full-Stack Engineer" for "Full Stack Developer")
- stack-specific names that fit their skills (for example "MERN Stack Developer", "React Node.js Developer")
- close neighbouring titles they clearly qualify for

Do not repeat the titles above. Do not add seniority words unless the titles above use them. Do not include roles in a different field.${removed.length ? `\nNever suggest these, the job seeker removed them: ${removed.join("; ")}` : ""}

Reply with only a JSON array of strings, like ["Full-Stack Engineer", "MERN Stack Developer"].`;
  const raw = await completeJson<unknown>(prompt, "score", "title variants");
  const have = new Set([...titles, ...removed].map((t) => t.trim().toLowerCase()));
  return [...new Set((Array.isArray(raw) ? raw : []).map((t) => String(t).replace(/\s+/g, " ").trim()))]
    .filter((t) => t.length > 2 && t.length < 80 && !have.has(t.toLowerCase()))
    .slice(0, 15);
}
