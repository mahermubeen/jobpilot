import { describe, expect, it } from "vitest";
import { leadScore } from "@/lib/pipeline/lead-score";
import { pickWebsite, rankEmails } from "@/lib/sources/contacts";
import { parseBoardResult } from "@/lib/sources/jobs";

const now = new Date("2026-10-13T12:00:00Z");

describe("leadScore", () => {
  it("ranks a strong fit with a verified email and phone at the top", () => {
    const score = leadScore(
      {
        jobs: [{ fit: "Strong", status: "Found", found: "2026-10-12" }],
        contacts: [{ email: "cto@acme.io", emailStatus: "verified", phone: "+1 415 555 0100", optedOut: false }],
        companyPhone: null,
        openRoles: 3,
      },
      now,
    );
    expect(score).toBe(100);
  });

  it("scores zero when every contact opted out", () => {
    expect(
      leadScore(
        {
          jobs: [{ fit: "Strong", status: "Found", found: "2026-10-12" }],
          contacts: [{ email: "a@b.co", emailStatus: "verified", phone: null, optedOut: true }],
          companyPhone: null,
          openRoles: 1,
        },
        now,
      ),
    ).toBe(0);
  });

  it("ignores rejected and skipped jobs", () => {
    const base = { contacts: [], companyPhone: null, openRoles: 0 };
    expect(leadScore({ ...base, jobs: [{ fit: "Strong", status: "Rejected", found: null }] }, now)).toBe(0);
    expect(leadScore({ ...base, jobs: [{ fit: "Partial", status: "Found", found: null }] }, now)).toBe(23);
  });
});

describe("rankEmails", () => {
  it("puts hiring inboxes first and drops junk and other domains", () => {
    const ranked = rankEmails(
      ["info@acme.io", "Jane.Doe@acme.io", "careers@acme.io", "noreply@acme.io", "logo@2x.png", "ceo@other.com", "careers@acme.io"],
      "acme.io",
    );
    expect(ranked.map((r) => r.email)).toEqual(["careers@acme.io", "jane.doe@acme.io", "info@acme.io"]);
    expect(ranked.map((r) => r.kind)).toEqual(["hiring", "person", "generic"]);
  });
});

describe("parseBoardResult", () => {
  it("reads Greenhouse, Lever and Ashby results", () => {
    expect(
      parseBoardResult("https://boards.greenhouse.io/acme/jobs/123", "Job Application for Senior Engineer at Acme"),
    ).toMatchObject({ company: "Acme", role: "Senior Engineer" });
    expect(
      parseBoardResult("https://jobs.lever.co/beta-labs/1f2e-33", "Beta Labs - Full Stack Engineer"),
    ).toMatchObject({ company: "Beta Labs", role: "Full Stack Engineer" });
    expect(
      parseBoardResult("https://jobs.ashbyhq.com/gamma/aaaa-bbbb", "React Native Engineer @ Gamma"),
    ).toMatchObject({ company: "Gamma", role: "React Native Engineer" });
  });

  it("ignores board home pages and other sites", () => {
    expect(parseBoardResult("https://jobs.lever.co/beta-labs", "Beta Labs")).toBeNull();
    expect(parseBoardResult("https://example.com/jobs/1", "Engineer at Example")).toBeNull();
  });
});

describe("pickWebsite", () => {
  const results = [
    "https://pk.indeed.com/q-northbay-solutions-jobs.html",
    "https://remotive.com/remote/jobs/solution-architect-1",
    "https://booksy.com/en-gb/north-bay-barbershop",
    "https://northbaysolutions.com/case-studies/x/",
  ];
  it("skips job boards and unrelated sites and returns the matching domain", () => {
    expect(pickWebsite("NorthBay Solutions", results)).toBe("https://northbaysolutions.com");
  });
  it("returns null instead of guessing", () => {
    expect(pickWebsite("Zephyr Quantum", results)).toBeNull();
  });
});
