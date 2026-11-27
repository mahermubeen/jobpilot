/**
 * Every place JobPilot looks for jobs, safe to import in the browser.
 * The code that searches each one lives in lib/pipeline/steps.ts (findJobs).
 */
export type SourceGroup = "board" | "api" | "remote" | "ats" | "social";

export type SourceDef = {
  key: string;
  label: string;
  group: SourceGroup;
  /** "free" costs nothing; "apify" runs a paid scraper counted against the monthly cap. */
  cost: "free" | "apify";
  defaultOn: boolean;
  hint: string;
};

export const SOURCES: SourceDef[] = [
  // Free job boards, scraped on this machine with JobSpy (github.com/speedyapply/JobSpy).
  { key: "jobspy-linkedin", label: "LinkedIn", group: "board", cost: "free", defaultOn: true, hint: "Scraped on this computer. LinkedIn may slow it down if you search a lot." },
  { key: "jobspy-indeed", label: "Indeed", group: "board", cost: "free", defaultOn: true, hint: "Needs the Indeed country set on a location." },
  { key: "jobspy-glassdoor", label: "Glassdoor", group: "board", cost: "free", defaultOn: true, hint: "Needs the Indeed country set on a location. Sometimes refuses requests." },
  { key: "jobspy-google", label: "Google Jobs", group: "board", cost: "free", defaultOn: true, hint: "Google's job search box, which collects listings from many sites." },
  { key: "jobspy-zip_recruiter", label: "ZipRecruiter", group: "board", cost: "free", defaultOn: true, hint: "US and Canada locations only." },
  { key: "jobspy-naukri", label: "Naukri", group: "board", cost: "free", defaultOn: true, hint: "India locations only." },
  { key: "jobspy-bayt", label: "Bayt", group: "board", cost: "free", defaultOn: true, hint: "Middle East, North Africa and Pakistan." },
  // Free official job board APIs; each needs a free key from the board.
  { key: "adzuna", label: "Adzuna", group: "api", cost: "free", defaultOn: true, hint: "US, UK, Canada, Australia, Germany, India and 13 more countries. Needs a free key from developer.adzuna.com." },
  { key: "reed", label: "Reed", group: "api", cost: "free", defaultOn: true, hint: "The UK's biggest job board. Needs a free key from reed.co.uk/developers." },
  { key: "jooble", label: "Jooble", group: "api", cost: "free", defaultOn: true, hint: "Collects jobs from thousands of sites in about 70 countries. Needs a free key from jooble.org/api/about." },
  // Free remote-job board APIs.
  { key: "remoteok", label: "Remote OK", group: "remote", cost: "free", defaultOn: true, hint: "Remote jobs feed." },
  { key: "remotive", label: "Remotive", group: "remote", cost: "free", defaultOn: true, hint: "Remote jobs feed." },
  { key: "weworkremotely", label: "We Work Remotely", group: "remote", cost: "free", defaultOn: true, hint: "Remote jobs feed." },
  { key: "himalayas", label: "Himalayas", group: "remote", cost: "free", defaultOn: true, hint: "Remote jobs, searched by title." },
  { key: "jobicy", label: "Jobicy", group: "remote", cost: "free", defaultOn: true, hint: "Remote jobs, searched by title." },
  { key: "arbeitnow", label: "Arbeitnow", group: "remote", cost: "free", defaultOn: true, hint: "Mostly Germany and Europe, incl. remote." },
  // Company career pages.
  { key: "ats", label: "Company career pages", group: "ats", cost: "free", defaultOn: true, hint: "Checks every Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee board JobPilot has seen, plus your watch list. Grows with every run." },
  // Free social sources.
  { key: "hn", label: "Hacker News “Who is hiring”", group: "social", cost: "free", defaultOn: true, hint: "This month's thread: one comment per company." },
  { key: "reddit", label: "Reddit", group: "social", cost: "free", defaultOn: true, hint: "[Hiring] posts in r/forhire, r/hiring, r/remotejs and similar. Reddit often blocks apps without a login; use the paid Reddit source if it does." },
  // Paid, through Apify. Off by default.
  { key: "linkedin", label: "LinkedIn (Apify)", group: "board", cost: "apify", defaultOn: false, hint: "≈ $0.40 per 1,000 jobs. More reliable than the free scrape, includes the job poster." },
  { key: "indeed", label: "Indeed (Apify)", group: "board", cost: "apify", defaultOn: false, hint: "≈ $0.05 per 1,000 jobs, with company details." },
  { key: "glassdoor", label: "Glassdoor (Apify)", group: "board", cost: "apify", defaultOn: false, hint: "≈ $0.40 per 1,000 jobs." },
  { key: "wellfound", label: "Wellfound (Apify)", group: "board", cost: "apify", defaultOn: false, hint: "Startup jobs. ≈ $3 per 1,000 jobs." },
  { key: "google", label: "Google search of career sites (Apify)", group: "ats", cost: "apify", defaultOn: false, hint: "Searches Greenhouse, Lever, Ashby, Workday and others by title. ≈ $0.50 per 1,000 results. Also feeds new companies to “Company career pages”." },
  { key: "craigslist", label: "Craigslist (Apify)", group: "board", cost: "apify", defaultOn: false, hint: "Software jobs and computer gigs in the Craigslist cities you list below (US, UK, Canada and more). ≈ $1.80 per 1,000 listings." },
  { key: "linkedin-posts", label: "LinkedIn hiring posts (Apify)", group: "social", cost: "apify", defaultOn: false, hint: "Posts like “we're hiring a …”. ≈ $2 per 1,000 posts." },
  { key: "x-posts", label: "X / Twitter hiring posts (Apify)", group: "social", cost: "apify", defaultOn: false, hint: "≈ $0.40 per 1,000 posts. Noisy." },
  { key: "reddit-apify", label: "Reddit (Apify)", group: "social", cost: "apify", defaultOn: false, hint: "Searches all of Reddit for hiring posts. ≈ $1.15 per 1,000 posts." },
];

export const sourceDef = (key: string) => SOURCES.find((s) => s.key === key);

export const defaultSources = (): Record<string, boolean> =>
  Object.fromEntries(SOURCES.map((s) => [s.key, s.defaultOn]));
