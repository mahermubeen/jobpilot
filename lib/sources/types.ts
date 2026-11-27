/** "listing" is a job ad on a board; "post" is a social post (Reddit, HN, LinkedIn, X) announcing a job. */
export type JobKind = "listing" | "post";

/** A job posting as returned by any source, before it is stored. */
export type RawJob = {
  /** Where it was found, e.g. "LinkedIn", "Glassdoor", "HN Who is hiring". */
  source: string;
  kind?: JobKind;
  sourceId: string;
  company: string;
  role: string;
  link: string;
  location: string;
  description: string;
  pay: string;
  mode: string;
  /** Label of the search location that found it, e.g. "Worldwide remote". */
  tier: string;
  /** Posting date as the board gives it (ISO date or "3 days ago"), when it does. */
  posted?: string;
  /** The employer's own application page, when the board gives it apart from `link`. */
  applyUrl?: string;
  /** Other sources that listed the same job in this run. */
  alsoOn?: string[];
  company_: {
    website?: string;
    linkedin?: string;
    size?: string;
    industry?: string;
    about?: string;
    address?: string;
  };
  recruiter?: { name: string; linkedin?: string };
};

export type SiteContacts = {
  domain: string;
  emails: string[];
  phones: string[];
  linkedIns: string[];
};
