import { describe, expect, it } from "vitest";
import { dedupeJobs, mergeJobs, roleKey } from "@/lib/pipeline/dedupe";
import { detectBoard, mapAshby, mapGreenhouse, mapLever, mapWorkable } from "@/lib/sources/ats";
import { defaultSources, SOURCES } from "@/lib/sources/catalog";
import { mapHimalayas, mapJobicy, mapRemoteOk, mapWeWorkRemotely } from "@/lib/sources/feeds";
import { mapLinkedInPosts, mapRedditApify, parseBoardResult } from "@/lib/sources/jobs";
import { buildQueries, jobSpyCountry, mapJobSpyRow, siteCovers } from "@/lib/sources/jobspy";
import { coreWords, excludedTitle, matchesTitle, searchTitles } from "@/lib/sources/match";
import { isoDate, payText, stripHtml } from "@/lib/sources/net";
import { companyFromText, mapReddit, parseHnComment, postToJob } from "@/lib/sources/social";
import type { RawJob } from "@/lib/sources/types";
import type { SearchLocation } from "@/lib/settings";

const remote: SearchLocation = { label: "Worldwide remote", linkedin: "Worldwide", indeedCountry: "", indeedLocation: "", remote: true };
const pk: SearchLocation = { label: "Pakistan", linkedin: "Pakistan", indeedCountry: "PK", indeedLocation: "Islamabad", remote: false };
const ctx = { titles: ["Full Stack Developer", "React Native Developer"], excludeTitleWords: ["intern"], locations: [remote, pk] };

describe("title matching", () => {
  it("treats wording variants of a title as the same", () => {
    expect(matchesTitle("Senior Full-Stack Engineer", ctx.titles)).toBe(true);
    expect(matchesTitle("Sr. Fullstack Dev (Remote)", ctx.titles)).toBe(true);
    expect(matchesTitle("React Native Engineer II", ctx.titles)).toBe(true);
  });
  it("needs every meaningful word", () => {
    expect(matchesTitle("React Developer", ctx.titles)).toBe(false);
    expect(matchesTitle("Full Stack Designer", ctx.titles)).toBe(false);
  });
  it("respects the skip list", () => {
    expect(matchesTitle("Full Stack Developer Intern", ctx.titles, ["intern"])).toBe(false);
    expect(excludedTitle("Internal Tools Engineer", ["intern"])).toBe(false);
  });
  it("lists own titles first and drops repeats and removed variants", () => {
    expect(
      searchTitles({
        titles: ["Full Stack Developer"],
        titleVariants: ["Full-Stack Engineer", "MERN Stack Developer", "Node.js Developer"],
        excludedVariants: ["node.js developer"],
      }),
    ).toEqual(["Full Stack Developer", "MERN Stack Developer"]);
    expect(coreWords("Sr. Node.js Engineer")).toEqual(["nodejs", "developer"]);
  });
});

describe("helpers", () => {
  it("formats pay the pay parser can read", () => {
    expect(payText(90000, 120000, "USD", "yearly")).toBe("USD 90000 - 120000 per year");
    expect(payText(0, 0, "USD", "year")).toBe("");
    expect(payText(null, 40, "EUR", "hourly")).toBe("EUR 40 per hour");
  });
  it("reads dates in seconds, milliseconds and text", () => {
    expect(isoDate(1794317072)).toBe("2026-11-10T13:24:32.000Z");
    expect(isoDate(1794317072000)).toBe("2026-11-10T13:24:32.000Z");
    expect(isoDate("not a date")).toBeUndefined();
  });
  it("turns HTML into text", () => {
    expect(stripHtml("<p>Hello&nbsp;<b>world</b></p><ul><li>One</li></ul>")).toBe("Hello world\n- One");
  });
});

describe("remote feeds", () => {
  it("maps Remote OK and skips its legal notice", () => {
    const jobs = mapRemoteOk([
      { id: "x" } as never,
      { id: "1", company: "Acme", position: "Full Stack Engineer", url: "https://remoteok.com/1", salary_min: 80000, salary_max: 100000, date: "2026-11-17T00:00:29+00:00" },
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ source: "Remote OK", company: "Acme", pay: "USD 80000 - 100000 per year", location: "Remote" });
  });
  it("splits We Work Remotely titles into company and role", () => {
    const xml = `<rss><channel><item><title>Acme Inc: Senior Full-Stack Developer</title><region>Anywhere in the World</region>
      <link>https://weworkremotely.com/remote-jobs/acme-1</link><pubDate>Tue, 18 Nov 2026 10:00:00 +0000</pubDate>
      <description>&lt;p&gt;Build things&lt;/p&gt;</description></item></channel></rss>`;
    expect(mapWeWorkRemotely(xml)[0]).toMatchObject({
      company: "Acme Inc", role: "Senior Full-Stack Developer", location: "Anywhere in the World", description: "Build things",
      posted: "2026-11-18T10:00:00.000Z",
    });
  });
  it("marks Himalayas jobs without restrictions as worldwide", () => {
    const [a, b] = mapHimalayas([
      { title: "React Native Developer", companyName: "Lemon", applicationLink: "https://himalayas.app/x", locationRestrictions: [] },
      { title: "React Native Developer", companyName: "Lime", applicationLink: "https://himalayas.app/y", locationRestrictions: ["Canada"] },
    ]);
    expect(a.location).toBe("Remote, worldwide");
    expect(b.location).toBe("Remote (Canada)");
  });
  it("reads Jobicy's geography", () => {
    expect(mapJobicy([{ id: 1, url: "u", jobTitle: "Full Stack Engineer", companyName: "Vantage", jobGeo: "Canada" }])[0].location).toBe("Remote (Canada)");
  });
});

describe("company career pages", () => {
  it("recognises board links", () => {
    expect(detectBoard("https://boards.greenhouse.io/Stripe/jobs/123")).toEqual({ ats: "greenhouse", slug: "stripe" });
    expect(detectBoard("https://boards.greenhouse.io/embed/job_app?for=acme&token=1")).toEqual({ ats: "greenhouse", slug: "acme" });
    expect(detectBoard("https://jobs.lever.co/palantir/6ed7")).toEqual({ ats: "lever", slug: "palantir" });
    expect(detectBoard("https://jobs.ashbyhq.com/ramp/34")).toEqual({ ats: "ashby", slug: "ramp" });
    expect(detectBoard("https://apply.workable.com/huggingface/j/81B4/")).toEqual({ ats: "workable", slug: "huggingface" });
    expect(detectBoard("https://apply.workable.com/j/81B4")).toBeNull();
    expect(detectBoard("https://acme.recruitee.com/o/dev")).toEqual({ ats: "recruitee", slug: "acme" });
    expect(detectBoard("https://www.linkedin.com/jobs/view/1")).toBeNull();
  });
  it("maps each system's JSON", () => {
    expect(mapGreenhouse("stripe", { jobs: [{ id: 1, title: "Engineer", absolute_url: "https://stripe.com/jobs?gh_jid=1", location: { name: "Remote" }, content: "&lt;p&gt;Hi&lt;/p&gt;", company_name: "Stripe" }] })[0])
      .toMatchObject({ company: "Stripe", description: "Hi", location: "Remote", sourceId: "greenhouse:stripe:1" });
    expect(mapLever("beta-labs", [{ id: "a", text: "Dev", hostedUrl: "https://jobs.lever.co/beta-labs/a", categories: { location: "Berlin" }, workplaceType: "remote", createdAt: 1786469891368 }])[0])
      .toMatchObject({ company: "Beta Labs", location: "Berlin (Remote)", mode: "Remote" });
    expect(mapAshby("ramp", { jobs: [{ id: "1", title: " Dev ", jobUrl: "u", location: "NYC", secondaryLocations: [{ location: "Remote (US)" }], isListed: true }, { id: "2", title: "Hidden", isListed: false }] }))
      .toEqual([expect.objectContaining({ role: "Dev", location: "NYC / Remote (US)" })]);
    expect(mapWorkable("hf", { name: "Hugging Face", jobs: [{ shortcode: "X", title: "ML Engineer", url: "u", city: "Paris", country: "France", telecommuting: true }] })[0])
      .toMatchObject({ company: "Hugging Face", location: "Paris, France (Remote)", mode: "Remote" });
  });
});

describe("Google career-board results", () => {
  it("still parses the original boards", () => {
    expect(parseBoardResult("https://jobs.lever.co/beta-labs/1f2e-33", "Beta Labs - Full Stack Engineer")).toMatchObject({ company: "Beta Labs", role: "Full Stack Engineer" });
  });
  it("parses the added boards", () => {
    expect(parseBoardResult("https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Senior-Developer_R1", "Senior Developer - Remote"))
      .toMatchObject({ company: "Acme", role: "Senior Developer" });
    expect(parseBoardResult("https://wellfound.com/jobs/123-dev", "Full Stack Engineer at Gamma • Remote | Wellfound"))
      .toMatchObject({ company: "Gamma", role: "Full Stack Engineer" });
    expect(parseBoardResult("https://beta.teamtailor.com/jobs/9-react-dev", "React Developer - Beta")).toMatchObject({ company: "Beta", role: "React Developer" });
  });
});

describe("JobSpy", () => {
  it("maps country codes to JobSpy names", () => {
    expect(jobSpyCountry("US")).toBe("usa");
    expect(jobSpyCountry("gb")).toBe("uk");
    expect(jobSpyCountry("PK")).toBe("pakistan");
    expect(jobSpyCountry("AE")).toBe("united arab emirates");
  });
  it("only asks sites that cover the location", () => {
    expect(siteCovers("indeed", remote)).toBe(false);
    expect(siteCovers("indeed", pk)).toBe(true);
    expect(siteCovers("zip_recruiter", pk)).toBe(false);
    expect(siteCovers("bayt", pk)).toBe(true);
    const qs = buildQueries({ boardTitles: ["Full Stack Developer"], locations: [remote, pk], postedWithinDays: 1, limit: 50 }, ["linkedin", "indeed", "google"]);
    expect(qs.map((q) => `${q.site}@${q.tier}`)).toEqual([
      "linkedin@Worldwide remote", "google@Worldwide remote", "linkedin@Pakistan", "indeed@Pakistan", "google@Pakistan",
    ]);
    expect(qs.find((q) => q.site === "indeed")).toMatchObject({ location: "Islamabad", country: "pakistan", hours_old: 24 });
    expect(qs[1].google_search_term).toBe("Full Stack Developer jobs remote since yesterday");
  });
  it("maps a result row", () => {
    const job = mapJobSpyRow({
      id: "li-1", site: "linkedin", job_url: "https://www.linkedin.com/jobs/view/1", job_url_direct: "https://jobs.lever.co/acme/1",
      title: "Full Stack Engineer", company: "Acme", location: "Lahore, Pakistan", date_posted: "2026-11-17T00:00:00.000",
      min_amount: 1000, max_amount: 2000, currency: "USD", interval: "monthly", is_remote: true, company_url: "https://www.linkedin.com/company/acme?trk=x",
    }, "Pakistan");
    expect(job).toMatchObject({
      source: "LinkedIn", applyUrl: "https://jobs.lever.co/acme/1", pay: "USD 1000 - 2000 per month", mode: "Remote",
      company_: { linkedin: "https://www.linkedin.com/company/acme" }, tier: "Pakistan",
    });
    expect(mapJobSpyRow({ site: "linkedin", title: "x" }, "")).toBeNull();
  });
});

describe("hiring posts", () => {
  it("reads an HN Who is hiring comment", () => {
    const job = parseHnComment(
      { objectID: "42", author: "pat", comment_text: "Acme Corp | Senior Full Stack Engineer | REMOTE (Worldwide) | $120k-$160k<p>We build things." },
      ctx,
    );
    expect(job).toMatchObject({
      company: "Acme Corp", role: "Senior Full Stack Engineer", location: "REMOTE (Worldwide)", pay: "$120k-$160k", mode: "Remote",
      kind: "post", link: "https://news.ycombinator.com/item?id=42",
    });
    expect(parseHnComment({ objectID: "43", comment_text: "Beta | Data Scientist | Onsite" }, ctx)).toBeNull();
  });
  it("keeps [Hiring] posts and drops people looking for work", () => {
    const posts = mapReddit({
      data: {
        children: [
          { data: { id: "a", title: "[Hiring] React Native Developer for fitness app", selftext: "Remote, paid hourly", permalink: "/r/forhire/a", author: "sam", created_utc: 1794317072 } },
          { data: { id: "b", title: "[For Hire] React Native Developer, 5 years", selftext: "Hire me", permalink: "/r/forhire/b", author: "lee" } },
        ],
      },
    });
    const jobs = posts.map((p) => postToJob(p, ctx)).filter(Boolean);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ role: "React Native Developer", company: "u/sam", mode: "Remote", link: "https://www.reddit.com/r/forhire/a" });
  });
  it("finds the company in LinkedIn posts", () => {
    const [p] = mapLinkedInPosts([{ id: "1", content: "We're hiring a Full Stack Developer! DM me.", linkedinUrl: "https://linkedin.com/posts/1", author: { name: "Ana", info: "Engineering Manager at Northwind" } }]);
    expect(p.company).toBe("Northwind");
    expect(postToJob(p, ctx)).toMatchObject({ company: "Northwind", role: "Full Stack Developer", recruiter: { name: "Ana" } });
    expect(companyFromText("Contoso is hiring a full stack developer")).toBe("Contoso");
  });
  it("skips Reddit comments from the paid scraper", () => {
    expect(mapRedditApify([{ id: "c", type: "comment", title: "", body: "x" }, { id: "p", title: "[Hiring] Dev", permalink: "/r/hiring/p" }]))
      .toEqual([expect.objectContaining({ id: "p", link: "https://www.reddit.com/r/hiring/p" })]);
  });
});

describe("merging repeats across sources", () => {
  const job = (over: Partial<RawJob>): RawJob => ({
    source: "LinkedIn", sourceId: "1", company: "Acme", role: "Sr. Full-Stack Engineer", link: "https://linkedin.com/jobs/view/1",
    location: "", description: "short", pay: "", mode: "", tier: "", company_: {}, ...over,
  });
  it("treats wording variants of a role at one company as one job", () => {
    expect(roleKey("Acme Inc", "Sr. Full-Stack Engineer")).toBe(roleKey("ACME", "Senior Fullstack Developer"));
  });
  it("keeps the fuller details and notes the other source", () => {
    const merged = mergeJobs(job({}), job({ source: "Glassdoor", sourceId: "g", description: "a much longer description", pay: "USD 5000 per month", company_: { size: "50" } }));
    expect(merged).toMatchObject({ source: "LinkedIn", description: "a much longer description", pay: "USD 5000 per month", alsoOn: ["Glassdoor"], company_: { size: "50" } });
  });
  it("merges repeats in one batch instead of dropping them", () => {
    const out = dedupeJobs(
      [job({}), job({ source: "Indeed", sourceId: "i", link: "https://indeed.com/1", role: "Senior Fullstack Developer", pay: "USD 1 per hour" }), job({ company: "Beta", sourceId: "2", link: "https://x/2" })],
      [],
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ alsoOn: ["Indeed"], pay: "USD 1 per hour" });
  });
});

describe("source catalog", () => {
  it("switches free sources on and paid ones off by default", () => {
    const d = defaultSources();
    for (const s of SOURCES) expect(d[s.key]).toBe(s.cost === "free");
    expect(new Set(SOURCES.map((s) => s.key)).size).toBe(SOURCES.length);
  });
});

describe("keyed job board APIs", () => {
  it("maps Adzuna results with the country's currency", async () => {
    const { mapAdzuna } = await import("@/lib/sources/keyed");
    const [j] = mapAdzuna(
      [{ id: 42, title: "<strong>Full Stack</strong> Developer", description: "Fully remote team…", redirect_url: "https://www.adzuna.co.uk/jobs/land/ad/42", created: "2026-11-18T09:00:00Z", company: { display_name: "Acme" }, location: { display_name: "London, UK" }, salary_min: 50000, salary_max: 70000 }],
      "gb",
      true,
    );
    expect(j).toMatchObject({ source: "Adzuna", sourceId: "adzuna:42", role: "Full Stack Developer", company: "Acme", location: "London, UK", mode: "Remote", posted: "2026-11-18T09:00:00.000Z" });
    expect(j.pay).toContain("GBP");
  });

  it("maps Reed results and reads its dd/mm/yyyy dates", async () => {
    const { mapReed, reedDate } = await import("@/lib/sources/keyed");
    expect(reedDate("19/11/2026")).toBe("2026-11-19T00:00:00.000Z");
    const [j] = mapReed([{ jobId: 7, employerName: "Beta Ltd", jobTitle: "React Native Developer", locationName: "Manchester", minimumSalary: 45000, maximumSalary: 55000, currency: "GBP", date: "19/11/2026", jobDescription: "Hybrid role", jobUrl: "https://www.reed.co.uk/jobs/7" }], false);
    expect(j).toMatchObject({ source: "Reed", sourceId: "reed:7", company: "Beta Ltd", mode: "", link: "https://www.reed.co.uk/jobs/7" });
    expect(j.pay).toBe("GBP 45000 - 55000 per year");
    expect(mapReed([{ jobTitle: "x", minimumSalary: 450, maximumSalary: 550 }], false)[0].pay).toBe("GBP 450 - 550 per day");
  });

  it("maps Jooble results", async () => {
    const { mapJooble } = await import("@/lib/sources/keyed");
    const [j] = mapJooble([{ id: "-123", title: "Full Stack Developer", location: "Remote", snippet: "&nbsp;Build things", salary: "$90k", link: "https://jooble.org/desc/-123", company: "Gamma", updated: "2026-11-19T10:00:00.0000000" }], true);
    expect(j).toMatchObject({ source: "Jooble", sourceId: "jooble:-123", company: "Gamma", mode: "Remote", pay: "$90k" });
    expect(j.posted).toMatch(/^2026-11-19/);
  });
});

describe("Craigslist", () => {
  it("builds search pages per city and section with the titles OR'd", async () => {
    const { craigslistUrls } = await import("@/lib/sources/jobs");
    const urls = craigslistUrls(["sfbay", " London ", "https://toronto.craigslist.org/", "bad city!"], ["Full Stack Developer", "React Developer"], true);
    expect(urls).toHaveLength(6);
    const sof = new URL(urls[0]);
    expect(sof.hostname).toBe("sfbay.craigslist.org");
    expect(sof.pathname).toBe("/search/sof");
    expect(sof.searchParams.get("query")).toBe('"Full Stack Developer"|"React Developer"');
    expect(sof.searchParams.get("is_telecommuting")).toBe("1");
    expect(new URL(urls[1]).searchParams.get("is_telecommuting")).toBeNull();
    expect(urls[2]).toContain("london.craigslist.org/search/sof");
  });

  it("maps listings and gigs", async () => {
    const { mapCraigslist } = await import("@/lib/sources/jobs");
    const jobs = mapCraigslist(
      [
        { postId: "1", title: "Full Stack Developer (remote ok)", url: "https://sfbay.craigslist.org/sfc/sof/d/x/1.html", description: "Acme is hiring a full stack developer", region: "sfbay", postedAt: "2026-11-19T08:00:00Z", attributes: { compensation: "$120k" } },
        { postId: "2", title: "Need a React dev", url: "https://london.craigslist.org/cpg/d/y/2.html", description: "Small gig", region: "london" },
      ],
      "Worldwide remote",
    );
    expect(jobs[0]).toMatchObject({ source: "Craigslist", kind: "listing", company: "Acme", pay: "$120k", mode: "Remote", sourceId: "craigslist:1" });
    expect(jobs[1]).toMatchObject({ kind: "post", company: "Craigslist poster (london)" });
  });

  it("is a paid source, off by default", () => {
    expect(SOURCES.find((s) => s.key === "craigslist")).toMatchObject({ cost: "apify", defaultOn: false });
    expect(SOURCES.filter((s) => s.group === "api").map((s) => s.key)).toEqual(["adzuna", "reed", "jooble"]);
  });
});
