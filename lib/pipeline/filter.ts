import { minPayUsdMonth, parsePay, type MinPay } from "@/lib/pay";
import { escapeRegExp } from "@/lib/util";

export type JobFilter = {
  minPay: MinPay;
  dropUnpaid: boolean;
  homeCity: string;
  /** Search locations from Settings; the non-worldwide ones name the user's own country. */
  locations?: { linkedin: string }[];
};

export type FilterableJob = {
  role: string;
  pay?: string | null;
  mode?: string | null;
  location?: string | null;
  description?: string | null;
};

const REMOTE = /\b(remote|remoto|remota|teletrabajo|teletravail|anywhere|worldwide|work from home|wfh)\b/;
const NOT_REMOTE = /\b(not|no|non)[ -]remote\b/;

/** Lower-cases and strips accents, so LinkedIn's "Islāmābād" matches "Islamabad". */
const plain = (text: string | null | undefined) =>
  (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const saysRemote = (text: string | null | undefined) => {
  const t = plain(text);
  return REMOTE.test(t) && !NOT_REMOTE.test(t);
};

// A listing located only in a country ("Pakistan", "United States") names no
// city, which is how job boards often show remote roles.
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRIES = new Set<string>();
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    const name = regionNames.of(code);
    if (name && name !== code) COUNTRIES.add(plain(name));
  }
}

const US_STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado",
  ct: "connecticut", de: "delaware", dc: "district of columbia", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky",
  la: "louisiana", me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota",
  ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire",
  nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota",
  oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
  sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia",
  wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
};
const CA_PROVINCES: Record<string, string> = {
  ab: "alberta", bc: "british columbia", mb: "manitoba", nb: "new brunswick",
  nl: "newfoundland and labrador", ns: "nova scotia", on: "ontario", pe: "prince edward island",
  qc: "quebec", sk: "saskatchewan",
};
const PLACE_NAMES = [...COUNTRIES, ...Object.values(US_STATES), ...Object.values(CA_PROVINCES)]
  .filter((n) => n.length > 3)
  .sort((a, b) => b.length - a.length);
const PLACE_RE = new RegExp(`\\b(${PLACE_NAMES.map(escapeRegExp).join("|")})\\b`);
const REGION_RE = /\b(europe|european union|eu|emea|north america|latin america|latam|americas|nordics|dach)\b/;
// Case-sensitive, so "join us" never reads as the United States.
const ALIAS_RE = /(?:^|[^A-Za-z])(USA|US|U\.S\.A?\.?|UK|UAE)(?![A-Za-z])/;
const CODE_RE = /,\s*([a-z]{2})(?=\s|,|$)/;

/** Where the user can work from: home city plus the places in non-worldwide search locations. */
export function homePlaces(filter: Pick<JobFilter, "homeCity" | "locations">): string[] {
  const parts = (filter.locations ?? [])
    .filter((l) => !/\b(worldwide|anywhere|global)\b/i.test(l.linkedin))
    .flatMap((l) => l.linkedin.split(","));
  return [...new Set([filter.homeCity, ...parts].map(plain).filter((p) => p.length > 1))];
}

/** "Austin, TX" or "Toronto, ON": the US state or Canadian province code, upper-cased. */
function stateCode(t: string): string | null {
  const code = t.match(CODE_RE)?.[1];
  return code && (US_STATES[code] || CA_PROVINCES[code]) ? code.toUpperCase() : null;
}

/** A country, region, US state or Canadian province named in the text (or its "City, ST" code). */
function namedPlace(text: string, t: string): string | null {
  const alias = text.match(ALIAS_RE)?.[1];
  if (alias) return alias;
  const named = t.match(PLACE_RE)?.[1] ?? t.match(REGION_RE)?.[1];
  if (named) return named;
  return stateCode(t);
}

/**
 * The first place in `text` outside the user's home, or null. Text that also
 * names a home place ("Pakistan or UAE") counts as open to them.
 */
export function foreignPlace(text: string, home: string[], { areas = false } = {}): string | null {
  const t = plain(text);
  if (!t || home.some((h) => t.includes(h))) return null;
  const place = namedPlace(text, t);
  if (place) return place;
  return areas && /\barea\b/.test(t) ? text.trim() : null;
}

const OPEN_WORLDWIDE =
  /\b(work from anywhere|anywhere in the world|from any country|in any country|any time ?zone|hiring (?:globally|worldwide)|hire (?:globally|worldwide)|candidates worldwide|remote[- ](?:worldwide|global)|(?:worldwide|global(?:ly)?)[- ]remote|open to (?:candidates|applicants) (?:worldwide|globally|from anywhere))\b/gi;

/** True when the text says anyone anywhere can apply, and not "anywhere within the US". */
function openWorldwide(text: string | null | undefined, home: string[]): boolean {
  for (const m of (text ?? "").matchAll(OPEN_WORLDWIDE)) {
    const after = (text ?? "").slice(m.index + m[0].length, m.index + m[0].length + 40);
    const narrowed = after.match(/^\s*(?:within|in|across|inside)\s+(?:the\s+)?(.*)/i);
    if (!narrowed || !foreignPlace(narrowed[1], home)) return true;
  }
  return false;
}

// Phrases that tie a remote job to one place; the captured text is checked for a foreign place.
const RESTRICTIONS = [
  /\b(?:located|based|resid(?:e|ing|ents?)|liv(?:e|ing))\s+(?:in|within)\s+(?:the\s+)?(.{1,40})/gi,
  /\b(?:authori[sz]ed|eligible|authori[sz]ation)\s+to\s+work\s+(?:in|within|for)\s+(?:the\s+)?(.{1,40})/gi,
  /([^\s]{1,20}(?:\s[^\s]{1,20})?)[- ](?:based|residents?|citizens?)\s+(?:only|candidates|applicants|required)\b/gi,
  /([^\s(]{1,20}(?:\s[^\s(]{1,20})?)\s+only\b/gi,
  /\bwithin\s+(?:the\s+)?(.{1,30})/gi,
];

/** The place a description limits applicants to, when that place isn't home. */
export function restrictedTo(description: string | null | undefined, home: string[]): string | null {
  const text = description ?? "";
  if (!text || openWorldwide(text, home)) return null;
  for (const re of RESTRICTIONS) {
    for (const m of text.matchAll(re)) {
      const place = foreignPlace(m[1], home);
      if (place) return place;
    }
  }
  return null;
}

type Check = (job: FilterableJob, filter: JobFilter, ctx: { places: string[] }) => string | null;

const payCheck: Check = (job, filter) => {
  const pay = parsePay(job.pay);
  if (filter.dropUnpaid) {
    if (/\b(volunteer|unpaid)\b/i.test(job.role) || pay.kind === "unpaid") return "Unpaid or volunteer";
    if (pay.kind === "equity") return "Equity only";
  }
  const min = minPayUsdMonth(filter.minPay);
  return min > 0 && pay.kind === "salary" && pay.maxUsdMonth < min ? `Pay below minimum (${job.pay})` : null;
};

// A remote job only helps if it hires where the user lives.
const locationAbroadCheck: Check = (job, _filter, { places }) => {
  const abroad = foreignPlace(job.location ?? "", places, { areas: true });
  return abroad && !openWorldwide(job.description, places) ? `Only for candidates in ${abroad} (${job.location})` : null;
};

// A listing placed in the user's own country already hires there, whatever offices the text mentions.
const descriptionRestrictionCheck: Check = (job, _filter, { places }) => {
  if (places.some((p) => plain(job.location).includes(p))) return null;
  const limited = restrictedTo(job.description, places);
  return limited ? `Must be based in ${limited}` : null;
};

const mentionsRemote = (job: FilterableJob, location: string) =>
  [job.mode, location, job.role, job.description].some((t) => saysRemote(t));

const onsiteElsewhereCheck: Check = (job, filter) => {
  const home = plain(filter.homeCity);
  const location = plain(job.location);
  if (!home || !location || location.includes(home) || COUNTRIES.has(location)) return null;
  return mentionsRemote(job, location) ? null : `Not remote and not in ${filter.homeCity.trim()} (${job.location})`;
};

/** Run in order; the first reason found wins. */
const CHECKS: Check[] = [payCheck, locationAbroadCheck, descriptionRestrictionCheck, onsiteElsewhereCheck];

/**
 * Why a job falls outside the user's pay and place rules, or null when it is
 * fine. Listings that state no pay, no location or only a country pass: only
 * a stated fact can rule a job out.
 */
export function rejectReason(job: FilterableJob, filter: JobFilter): string | null {
  const ctx = { places: homePlaces(filter) };
  for (const check of CHECKS) {
    const reason = check(job, filter, ctx);
    if (reason) return reason;
  }
  return null;
}
