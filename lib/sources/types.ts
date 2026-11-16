/** A job posting as returned by any source, before it is stored. */
export type RawJob = {
  source: "LinkedIn" | "Indeed" | "Google";
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
