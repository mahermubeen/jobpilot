import { describe, expect, it } from "vitest";
import { companyId, companyKey, dedupeJobs, jobId } from "@/lib/pipeline/dedupe";
import type { RawJob } from "@/lib/sources/types";

const raw = (over: Partial<RawJob>): RawJob => ({
  source: "LinkedIn",
  sourceId: "1",
  company: "Acme",
  role: "Full Stack Engineer",
  link: "https://www.linkedin.com/jobs/view/1",
  location: "",
  description: "",
  pay: "",
  mode: "",
  tier: "",
  company_: {},
  ...over,
});

describe("company keys", () => {
  it("treats legal suffixes and case as the same company", () => {
    expect(companyKey("Acme, Inc.")).toBe(companyKey("ACME"));
    expect(companyId("NorthBay Solutions Pvt Ltd")).toBe("northbay-solutions");
  });
});

describe("dedupeJobs", () => {
  const existing = [
    { company: "Acme Inc", role: "Full-Stack Engineer", link: "https://x.com/a/", source: "Indeed", sourceId: "abc" },
  ];

  it("drops a job with the same company and role from another source", () => {
    expect(dedupeJobs([raw({ sourceId: "9", link: "https://l.com/9" })], existing)).toHaveLength(0);
  });

  it("drops a job with the same link, ignoring query and trailing slash", () => {
    const job = raw({ company: "Other", role: "Dev", sourceId: "7", link: "https://x.com/a?utm=1" });
    expect(dedupeJobs([job], existing)).toHaveLength(0);
  });

  it("drops a job with the same source id", () => {
    const job = raw({ source: "Indeed", sourceId: "abc", company: "New", role: "Role", link: "https://n.com" });
    expect(dedupeJobs([job], existing)).toHaveLength(0);
  });

  it("keeps new jobs and removes repeats inside the batch", () => {
    const a = raw({ company: "Beta", sourceId: "2", link: "https://l.com/2" });
    const b = raw({ company: "Beta", sourceId: "3", link: "https://l.com/3" });
    const c = raw({ company: "Gamma", sourceId: "4", link: "https://l.com/4" });
    expect(dedupeJobs([a, b, c], existing).map((j) => j.company)).toEqual(["Beta", "Gamma"]);
  });
});

describe("jobId", () => {
  it("adds a number when the readable id is taken", () => {
    const taken = new Set(["acme-engineer"]);
    expect(jobId("Acme", "Engineer", taken)).toBe("acme-engineer-2");
    expect(jobId("Acme", "Engineer", taken)).toBe("acme-engineer-3");
  });
});
