import { describe, expect, it } from "vitest";
import { companyId, companyKey, dedupeJobs, findDuplicates, jobId, jobKeys, linkKey, placeholderCompany, roleKey } from "@/lib/pipeline/dedupe";
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
    const job = raw({ company: "Other", role: "Dev", sourceId: "7", link: "https://www.x.com/a?utm_source=li&ref=feed" });
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

describe("one card per job", () => {
  it("keeps Indeed jobs apart by their jk id", () => {
    expect(linkKey("https://pk.indeed.com/viewjob?jk=617a92989730d786")).toBe("indeed:617a92989730d786");
    expect(linkKey("https://pk.indeed.com/viewjob?jk=aaa")).not.toBe(linkKey("https://pk.indeed.com/viewjob?jk=bbb"));
    const a = raw({ source: "Indeed", sourceId: "a", company: "A", link: "https://pk.indeed.com/viewjob?jk=aaa" });
    const b = raw({ source: "Indeed", sourceId: "b", company: "B", link: "https://pk.indeed.com/viewjob?jk=bbb" });
    expect(dedupeJobs([b], [{ ...a, sourceId: "a" }])).toHaveLength(1);
  });

  it("knows one LinkedIn or Greenhouse job under different links", () => {
    expect(linkKey("https://pk.linkedin.com/jobs/view/senior-dev-at-acme-4012345678?trk=x")).toBe(linkKey("https://www.linkedin.com/jobs/view/4012345678/"));
    expect(linkKey("https://acme.com/careers?gh_jid=555")).toBe(linkKey("https://boards.greenhouse.io/acme/jobs/555"));
  });

  it("ignores tracking parameters but keeps ones that name the job", () => {
    expect(linkKey("https://jobs.x.com/a?utm_source=himalayas.app&ref=himalayas.app")).toBe(linkKey("https://jobs.x.com/a"));
    expect(linkKey("https://jobs.x.com/view?id=1")).not.toBe(linkKey("https://jobs.x.com/view?id=2"));
  });

  it("ignores tags boards add to titles", () => {
    expect(roleKey("commercetools", "Senior Search Backend Engineer (m/f/x)")).toBe(roleKey("commercetools", "Senior Search Backend Engineer"));
    expect(roleKey("BairesDev", "Backend Engineer (PHP) - Remote Work | REF#310267")).toBe(roleKey("BairesDev", "Backend Engineer (PHP)"));
    expect(roleKey("Smart Working", "Sr. React Native Developer (Remote, Full-Time) [HR222] (PK)")).not.toBe(roleKey("Smart Working", "Computational Designer"));
    expect(roleKey("Acme", "Full Stack Engineer (Node/Python and React)")).not.toBe(roleKey("Acme", "Full Stack Engineer"));
    expect(companyKey("The Acme.io")).toBe(companyKey("Acme"));
  });

  it("never matches placeholder companies by title alone", () => {
    expect(placeholderCompany("Craigslist poster (sfbay)")).toBe(true);
    expect(placeholderCompany("u/someone")).toBe(true);
    expect(placeholderCompany("Jobs")).toBe(true);
    expect(placeholderCompany("Acme")).toBe(false);
    const gig = (n: string) => raw({ source: "Craigslist", sourceId: n, company: "Craigslist poster (sfbay)", role: "Full Stack Developer", link: `https://sfbay.craigslist.org/cpg/d/x/${n}.html` });
    expect(dedupeJobs([gig("1"), gig("2")], [])).toHaveLength(2);
  });

  it("skips jobs you deleted", () => {
    const gone = jobKeys({ company: "Acme", role: "Full Stack Engineer", link: "https://x.com/old", source: "LinkedIn", sourceId: "1" });
    expect(dedupeJobs([raw({ sourceId: "99", link: "https://elsewhere.com/1" })], [], gone)).toHaveLength(0);
  });

  it("groups saved duplicates and keeps the one furthest along", () => {
    const row = (id: string, status: string, role: string) => ({ id, status, company: "commercetools", role, link: `https://x.com/${id}`, source: "Arbeitnow", sourceId: id });
    const [g] = findDuplicates([row("a", "Found", "Senior Search Backend Engineer (m/f/x)"), row("b", "Applied", "Senior Search Backend Engineer"), row("c", "Found", "Data Engineer")]);
    expect(g.keep.id).toBe("b");
    expect(g.extra.map((j) => j.id)).toEqual(["a"]);
  });
});
