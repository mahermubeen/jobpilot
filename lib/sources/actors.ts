/**
 * The Apify actors JobPilot uses and what they cost on Apify's free tier.
 * To switch scraper, change the id here and adjust the mapping in the matching
 * source file. Prices are used for the local spend estimate and cap.
 */
export const ACTORS = {
  linkedin: {
    id: "valig/linkedin-jobs-scraper",
    usdPerRun: 0.001,
    usdPerItem: 0.0004,
  },
  indeed: {
    id: "kaix/indeed-scraper",
    usdPerRun: 0.00001,
    usdPerItem: 0.00005,
  },
  /** Billed per results page (up to 10 results). One query = one page here. */
  google: {
    id: "scraperlink/google-search-results-serp-scraper",
    usdPerRun: 0,
    usdPerItem: 0.0005,
  },
  /** Billed per page crawled on a company website. */
  contacts: {
    id: "vdrmota/contact-info-scraper",
    usdPerRun: 0.001,
    usdPerItem: 0.002,
  },
} as const;

export type ActorKey = keyof typeof ACTORS;
