import { beforeEach, describe, expect, it, vi } from "vitest";

const completeJson = vi.fn();
vi.mock("@/lib/ai/provider", () => ({ completeJson, complete: vi.fn() }));

const { draftApplication, letterProblem } = await import("@/lib/ai/tasks");
const { pageText, researchCompany, siteFor } = await import("@/lib/apply/research");
const { emptyProfile } = await import("@/lib/cv/types");

const profile = {
  ...emptyProfile,
  name: "Sara Khan",
  email: "sara@example.com",
  phone: "+92 300 1234567",
  experience: [
    { company: "Acme", title: "Engineer", location: "Lahore", start: "2020", end: "now", bullets: ["Built chat for 2M users"] },
  ],
};

const letter = `Dear Hiring Team,

I'm applying for the AI Engineer role in the Agent team.

The problem: after every support call, agents retype the notes into the CRM by hand, which takes minutes per call and loses detail.

My approach: a small agent that drafts the call summary, finds the customer record and prepares the case. The human confirms in one click and every action is logged.

About me: 6 years as a Full Stack Engineer. I built chat for 2M users at Acme and shipped AI features to production.

Could I walk you through it in a 10-minute call?

Sara Khan
+92 300 1234567`;

const answer = (body = letter) => ({
  research: "They sell a contact-centre product.",
  problem: "Agents retype notes.",
  approach: "An agent that drafts the summary.",
  buildPlan: ["Fake 3 calls", "Build the MCP server", ""],
  subject: "I designed an after-call agent for your CRM | AI Engineer",
  body,
  cv: {},
});

const job = { company: "Anywhere", role: "AI Engineer", location: null, description: "Build agents.", research: "Contact-centre software on Teams." };

describe("draftApplication", () => {
  beforeEach(() => completeJson.mockReset());

  it("passes the research and returns the pitch", async () => {
    completeJson.mockResolvedValueOnce(answer());
    const draft = await draftApplication(profile, job, null);
    const prompt = completeJson.mock.calls[0][0] as string;
    expect(prompt).toContain("Contact-centre software on Teams.");
    expect(prompt).toContain("The problem: ");
    expect(prompt).toContain('"Dear Hiring Team,"');
    expect(draft.body).toBe(letter);
    expect(draft.pitch.buildPlan).toEqual(["Fake 3 calls", "Build the MCP server"]);
    expect(draft.pitch.subject).toBe(draft.subject);
  });

  it("greets a named contact by first name", async () => {
    completeJson.mockResolvedValueOnce(answer());
    await draftApplication(profile, job, { name: "Lena Berg", title: "CTO" });
    expect(completeJson.mock.calls[0][0]).toContain('"Hi Lena,"');
  });

  it("asks again when the letter misses the shape, then gives up", async () => {
    completeJson.mockResolvedValueOnce(answer("Hi, I want the job. ".repeat(30)));
    completeJson.mockResolvedValueOnce(answer());
    await expect(draftApplication(profile, job, null)).resolves.toMatchObject({ body: letter });
    expect(completeJson.mock.calls[1][0]).toContain('missing "The problem:"');

    completeJson.mockResolvedValue(answer("too short"));
    await expect(draftApplication(profile, job, null)).rejects.toThrow(/incomplete cover letter/);
  });
});

describe("letterProblem", () => {
  it("accepts the agreed shape only", () => {
    expect(letterProblem(letter)).toBeNull();
    expect(letterProblem(letter.replace("My approach:", "Idea:"))).toMatch(/My approach/);
  });
});

describe("research", () => {
  const html = (title: string, text: string) =>
    `<html><head><title>${title}</title></head><body><nav><a>Home</a> <a>Pricing and plans for every team</a></nav><p>${text}</p><footer>Copyright notice for the whole site here</footer></body></html>`;

  it("keeps real sentences and drops menus", () => {
    const t = pageText(html("Anywhere", "We help contact centres run on Microsoft Teams with less effort."));
    expect(t).toContain("contact centres");
    expect(t).not.toContain("Pricing");
    expect(t).not.toContain("Copyright");
  });

  it("never treats a job board as the company site", () => {
    expect(siteFor({ company: "Anywhere", link: "https://www.linkedin.com/jobs/1", description: null }, null)).toBeNull();
    expect(siteFor({ company: "Anywhere", link: "https://anywhere.com/careers/1", description: null }, null)).toBe("https://anywhere.com");
  });

  it("reads the site, skips repeats and failures, and caps the size", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/about")) throw new Error("404");
      if (url.endsWith("/about-us")) return html("Anywhere", "We help contact centres run on Microsoft Teams with less effort.");
      if (url.includes("/jobs/")) return html("Job", "You will build AI agents for our customers. ".repeat(200));
      return html("Anywhere", `Page ${url} explains what the product does for support teams.`);
    });
    const company = { website: "https://anywhere.com", about: "Teams contact centre", industry: null, stack: "C#", size: null, research: null, researchedAt: null };
    const r = await researchCompany({ company: "Anywhere", link: "https://anywhere.com/jobs/1", description: "short" }, company, { fetch });
    expect(r.text).toContain("About: Teams contact centre");
    expect(r.text).toContain("Tech stack: C#");
    expect(r.fresh).toContain("[/about-us]");
    expect(r.text).toContain("From the job post page");
    expect(r.text.length).toBeLessThanOrEqual(6000);
  });

  it("uses cached research while it is fresh", async () => {
    const fetch = vi.fn(async () => "");
    const now = new Date("2026-11-27");
    const company = { website: "https://anywhere.com", about: null, industry: null, stack: null, size: null, research: "cached text", researchedAt: new Date("2026-11-20") };
    const r = await researchCompany({ company: "Anywhere", link: null, description: null }, company, { fetch, now });
    expect(r.text).toContain("cached text");
    expect(r.fresh).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
