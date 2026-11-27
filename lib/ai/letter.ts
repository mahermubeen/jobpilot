import type { CvVariant, Profile } from "@/lib/cv/types";
import { sanitizeVariant } from "@/lib/cv/variant";
import type { Pitch } from "@/lib/db/schema";
import { truncate } from "@/lib/util";
import { profileText } from "./profile-text";
import { complete, completeJson } from "./provider";

export type OutreachDraft = { subject: string; body: string; cvVariant: CvVariant; pitch: Pitch };

export type JobForDraft = {
  company: string;
  role: string;
  location: string | null;
  description: string | null;
  link?: string | null;
  mode?: string | null;
  /** Everything we read about the company (see lib/apply/research.ts). */
  research?: string | null;
};

// An example of the right shape and tone. The candidate, company and products
// are fictional; the prompt tells the model not to reuse any of it.
const EXAMPLE_LETTER = `Subject: I designed a delivery-exception agent for the Tidewell dispatch console | AI Engineer

Dear Hiring Team,

I'm applying for the AI Engineer role in the Dispatch Automation team.

The problem: when a delivery fails, a dispatcher still reads the driver's note, checks the order and messages the customer by hand. On busy days that queue holds hundreds of exceptions.

My approach: an agent inside the dispatch console that reads each exception, matches it to the order and drafts the next step: rebook, refund or a customer message. The dispatcher approves it in one click, the agent acts only with that dispatcher's permissions, and every action is logged.

About me: 7 years as a Full Stack Engineer and Tech Lead. At Northwind Labs I shipped LLM features to production and cut support handling time by 30%. At Example Corp I built a real-time chat system used by 200,000 people a day. I'm currently strengthening my Go to work fully in your stack.

Could I walk you through it in a 10-minute call?

Alex Doe
+1 555 0100`;

/** Why a letter does not have the agreed shape, or null when it does. */
export function letterProblem(body: string): string | null {
  if (body.length < 400) return "the letter is too short";
  for (const label of ["The problem:", "My approach:", "About me:"]) {
    if (!body.includes(label)) return `the letter is missing "${label}"`;
  }
  return null;
}

type Contact = { name?: string | null; title?: string | null } | null;

/** A first name to greet, unless the contact is a shared inbox ("Hiring Team"). */
const greetingNameOf = (contact: Contact) =>
  contact?.name && !/team|hiring|recruit|careers/i.test(contact.name) ? contact.name.split(" ")[0] : null;

const bulletList = (profile: Profile) =>
  profile.experience.map((e) => `${e.company} (${e.title}):\n` + e.bullets.map((b) => `  - ${b}`).join("\n")).join("\n");

const recipientLine = (greetingName: string | null, contact: Contact) =>
  greetingName ? `Name: ${contact?.name}${contact?.title ? `, ${contact.title}` : ""}` : "A shared hiring inbox, no named person.";

/** The goal, then the candidate, the job, the research and the recipient. */
function letterContext(profile: Profile, job: JobForDraft, contact: Contact, greetingName: string | null): string {
  return `Write a cover letter and choose CV content for this candidate and this job.

The goal: the recruiter should feel the candidate studied their company and already thought through something worth building for them, so they reply and book a short call. On that call the candidate shows the thing. So the letter pitches one concrete build for one concrete problem the company has.

<candidate>
${profileText(profile)}
Email: ${profile.email}
Phone: ${profile.phone}
Links: ${profile.links.map((l) => `${l.label}: ${l.url}`).join(", ")}
</candidate>

<job>
Company: ${job.company}
Role: ${job.role}
Location: ${job.location ?? "unknown"}
Work mode: ${job.mode || "unknown"}
Link: ${job.link || "none"}
Description:
${truncate(job.description, 6000) || "not available"}
</job>

<company_research>
${job.research?.trim() || "Nothing beyond the job description. Infer the product from the description only."}
</company_research>

<recipient>
${recipientLine(greetingName, contact)}
</recipient>`;
}

/** Fixed rules about honesty: these never change between jobs. */
const LETTER_RULES = `

Rules that cannot be broken:
- Claims about the candidate use only facts in <candidate>. Never add an employer, tool, number, title or year that is not there.
- The build is a proposal. Never say it already exists, is deployed, or that the candidate worked with this company.
- If the job needs a skill the candidate lacks, leave it out, or add at most one honest line such as "I'm currently strengthening my X to work fully in your stack."
- Do not copy sentences from the job description or the website.`;

/** The reasoning fields the model fills in before writing. */
const THINK_STEPS = `

Think first, in this order:
1. "research": 2 to 3 sentences on what the company sells, who uses it, and what this role or team is hired to do. Use their product names and terms.
2. "problem": one specific, believable pain their users or team have today that this role exists to fix. Name the moment and the people it hurts ("after each support call, agents still..."), not a generic "scaling" or "improving quality".
3. "approach": the thing the candidate would build: what it does, how it works step by step, which of their tools or stack it uses, and one detail that makes it safe, trusted or measurable. It must be a small prototype this candidate could demo within 1 to 2 weeks using skills in <candidate>.
4. "buildPlan": 3 to 6 short steps the candidate follows to build the demo before the call (tools, data to fake, what to show). This is private notes, not part of the letter.`;

/** The subject and body shape, with the greeting and sign-off for this candidate. */
function writeInstructions(profile: Profile, job: JobForDraft, greeting: string): string {
  return `

Then write:
- "subject": under 90 characters, in the shape "I designed <the specific build> for <their product or team> | ${job.role}".
- "body": plain text, 130 to 190 words, exactly these paragraphs separated by blank lines:
  "${greeting}"
  "I'm applying for the ${job.role} role" plus the team or product name when the job names one, one sentence.
  "The problem: " then the problem in one or two plain sentences.
  "My approach: " then the build in two or three sentences, in their terms.
  "About me: " then years and title, then two or three proofs from <candidate> that make the build believable, with real numbers and product names. Optionally the one honest gap line.
  "Could I walk you through it in a 10-minute call?"
  Then the sign-off: ${profile.name} and ${profile.phone} on separate lines.
  No bullet points, no buzzwords, no flattery, no "I am writing to", no "I am excited", no mention of an attached CV. Short sentences a person would say out loud.`;
}

/** The example letter, the CV selection rules and the reply shape. */
function cvInstructions(numbered: string): string {
  return `

This is an example of the right shape and tone. It is for a different company: do not reuse its problem, build or wording.
<example>
${EXAMPLE_LETTER}
</example>

The CV selection ("cv"):
- "headline": one line under their name, built from titles and technologies they really have, ordered for this job.
- "summary": two sentences, max 55 words, only restating facts from <candidate>, leading with what this job cares about.
- "experience": for each employer, the bullets to show, copied character for character from the lists below, most relevant first. Keep 3 to 5 per employer. Do not edit the wording.
- "skills": the skill groups to show, most relevant first, using only skills from <candidate>, reordered so the ones this job names come first.
- "projects": project names to show, most relevant first.

Bullets you may choose from:
${numbered}

Reply with only this JSON:
{"research": "...", "problem": "...", "approach": "...", "buildPlan": ["..."], "subject": "...", "body": "...", "cv": {"headline": "...", "summary": "...", "experience": [{"company": "...", "bullets": ["..."]}], "skills": [{"category": "...", "items": ["..."]}], "projects": ["..."]}}`;
}

type RawDraft = {
  research?: string;
  problem?: string;
  approach?: string;
  buildPlan?: unknown;
  subject?: string;
  body?: string;
  cv?: Partial<CvVariant>;
};

/** Asks for the letter; one more try, saying what was wrong, when its shape is off. */
async function askForLetter(prompt: string): Promise<{ raw: RawDraft; issue: string | null }> {
  const raw = await completeJson<RawDraft>(prompt, "write", "cover letter");
  const issue = letterProblem(String(raw.body ?? "").trim());
  if (!issue) return { raw, issue };
  const retry = await completeJson<RawDraft>(`${prompt}\n\nYour last answer was rejected because ${issue}. Follow the body shape exactly.`, "write", "cover letter");
  return { raw: retry, issue: letterProblem(String(retry.body ?? "").trim()) };
}

const buildPlanOf = (v: unknown) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean).slice(0, 8) : []);

function toPitch(raw: RawDraft, subject: string): Pitch {
  return {
    subject,
    research: String(raw.research ?? "").trim(),
    problem: String(raw.problem ?? "").trim(),
    approach: String(raw.approach ?? "").trim(),
    buildPlan: buildPlanOf(raw.buildPlan),
  };
}

/**
 * Writes the cover letter (also the outreach email) and picks the CV content
 * for one job. The letter names a real problem the company has and the thing
 * the candidate would build for it, so the recruiter wants the call where it
 * gets shown. The CV part can only select and reorder master CV content;
 * sanitizeVariant enforces that.
 */
export async function draftApplication(profile: Profile, job: JobForDraft, contact: Contact): Promise<OutreachDraft> {
  const greetingName = greetingNameOf(contact);
  const greeting = greetingName ? `Hi ${greetingName},` : "Dear Hiring Team,";
  const prompt =
    letterContext(profile, job, contact, greetingName) + LETTER_RULES + THINK_STEPS + writeInstructions(profile, job, greeting) + cvInstructions(bulletList(profile));

  const { raw, issue } = await askForLetter(prompt);
  const subject = truncate(String(raw.subject ?? ""), 120);
  const body = String(raw.body ?? "").trim();
  if (!subject || issue) {
    throw new Error(`The AI returned an incomplete cover letter (${issue ?? "no subject"}). Try again.`);
  }
  return { subject, body, cvVariant: sanitizeVariant(profile, raw.cv), pitch: toPitch(raw, subject) };
}

/** A short nudge sent in the same thread when there has been no reply. */
export async function draftFollowUp(
  profile: Profile,
  original: { subject: string; body: string; company: string; role: string },
): Promise<{ subject: string; body: string }> {
  const prompt = `Write a short follow-up to this job application email, which got no reply.

<original>
Subject: ${original.subject}

${original.body}
</original>

Company: ${original.company}
Role: ${original.role}
Sender: ${profile.name}

Rules: plain text, 45 to 70 words, polite and direct. Say you are following up on the ${original.role} application, add one useful fact from the original email (not a new claim), and ask whether they are still hiring for it. Keep the same greeting style and sign off with the sender's name only. No apology for following up.

Reply with only the email body text.`;
  const body = (await complete(prompt, "write")).trim();
  const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
  return { subject, body };
}
