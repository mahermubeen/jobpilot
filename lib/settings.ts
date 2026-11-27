import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { emptyProfile, type Profile } from "@/lib/cv/types";
import type { MinPay } from "@/lib/pay";
import { DEFAULT_CHAIN, normaliseChain, type ChainEntry } from "@/lib/ai/catalog";
import { defaultSources } from "@/lib/sources/catalog";

export type SearchLocation = {
  /** Shown on job cards, e.g. "Worldwide remote". */
  label: string;
  /** Location text for LinkedIn, e.g. "Pakistan" or "Worldwide". */
  linkedin: string;
  /** Two-letter Indeed country site, e.g. "US", "PK". Empty skips Indeed. */
  indeedCountry: string;
  /** City or region for Indeed. Empty means the whole country. */
  indeedLocation: string;
  remote: boolean;
};

/** Your standing facts for application forms. The question bank answers from these without AI. */
export type ApplyFacts = {
  city: string;
  region: string;
  country: string;
  postalCode: string;
  address: string;
  nationality: string;
  pronouns: string;
  /** Countries you may work in without sponsorship. */
  authorizedCountries: string[];
  totalYears: string;
  noticeDays: number;
  relocate: boolean;
  workModes: ("Remote" | "Hybrid" | "Onsite")[];
  employmentTypes: ("Full-time" | "Part-time" | "Contract" | "Internship")[];
  travel: boolean;
  timezone: string;
  hoursOverlap: string;
  english: string;
  languages: string;
  /** Monthly amounts in `currency`. Range maximum is asked for when a job states one, never below `floor`. */
  salary: { currency: string; target: number; last: number; floor: number };
  gender: string;
  ethnicity: string;
  hispanic: string;
  veteran: string;
  disability: string;
  orientation: string;
  transgender: string;
};

export type AppSettings = {
  setupDone: boolean;
  ai: {
    /** AIs in the order they are tried. Each task goes to the first one that is on, set up and has credit. */
    chain: ChainEntry[];
  };
  search: {
    titles: string[];
    locations: SearchLocation[];
    excludeTitleWords: string[];
    /** AI-suggested alternative names for the titles, searched as well. */
    titleVariants: string[];
    /** What the variants were made from (titles and CV), so they are remade only when that changes. */
    variantsKey: string;
    /** Variants the user removed; never searched or suggested again. */
    excludedVariants: string[];
    /** Make variants automatically before each search. */
    autoVariants: boolean;
    /** Company career pages to check every run, e.g. https://jobs.lever.co/acme. */
    watchCompanies: string[];
    /** Countries searched for remote locations on boards with no worldwide site (Adzuna). */
    remoteCountries: string[];
    /** Craigslist city subdomains to search, e.g. "sfbay", "london". */
    craigslistCities: string[];
    /** Most jobs per search on paid (Apify) sources. */
    maxPerSearch: number;
    /** Most jobs per search on free sources. */
    maxPerFreeSearch: number;
    /** On/off per source key in lib/sources/catalog.ts. */
    sources: Record<string, boolean>;
    /** Jobs stating pay below this are dropped. Amount 0 turns the rule off. */
    minPay: MinPay;
    /** Drop equity-only, volunteer and unpaid jobs. */
    dropUnpaid: boolean;
    /** Onsite and hybrid jobs are kept only in this city. Empty keeps every location. */
    homeCity: string;
  };
  caps: {
    dailySend: number;
    apifyMonthlyUsd: number;
    enrichPerRun: number;
    draftPerRun: number;
  };
  schedule: { enabled: boolean; time: string };
  outreach: { followUpDays: number; callScript: string };
  /** Your own answers to application questions, used before any AI. */
  applyAnswers: { question: string; answer: string }[];
  applyFacts: ApplyFacts;
};

export type Secrets = {
  anthropicKey: string;
  openaiKey: string;
  geminiKey: string;
  xaiKey: string;
  groqKey: string;
  /** Key for the "Other OpenAI-style server" entry. */
  aiKey: string;
  apifyToken: string;
  gmailUser: string;
  gmailAppPassword: string;
  apolloKey: string;
  /** Free job board API keys. */
  adzunaAppId: string;
  adzunaKey: string;
  reedKey: string;
  joobleKey: string;
};

export const defaultSettings: AppSettings = {
  setupDone: false,
  applyAnswers: [
    "Expected salary",
    "Notice period",
    "Work authorisation (countries you can legally work in)",
    "Need visa sponsorship?",
    "Willing to relocate?",
    "Total years of professional experience",
    "Earliest start date",
  ].map((question) => ({ question, answer: "" })),
  ai: { chain: DEFAULT_CHAIN },
  applyFacts: {
    city: "",
    region: "",
    country: "",
    postalCode: "",
    address: "",
    nationality: "",
    pronouns: "",
    authorizedCountries: [],
    totalYears: "",
    noticeDays: 14,
    relocate: false,
    workModes: ["Remote", "Hybrid", "Onsite"],
    employmentTypes: ["Full-time", "Contract"],
    travel: true,
    timezone: "",
    hoursOverlap: "Yes, I can overlap with US and European working hours.",
    english: "Fluent",
    languages: "",
    salary: { currency: "USD", target: 0, last: 0, floor: 0 },
    gender: "Prefer not to say",
    ethnicity: "Prefer not to say",
    hispanic: "Prefer not to say",
    veteran: "Prefer not to say",
    disability: "Prefer not to say",
    orientation: "Prefer not to say",
    transgender: "Prefer not to say",
  },
  search: {
    titles: [],
    locations: [],
    excludeTitleWords: ["intern", "unpaid", "volunteer"],
    titleVariants: [],
    variantsKey: "",
    excludedVariants: [],
    autoVariants: true,
    watchCompanies: [],
    remoteCountries: ["us", "gb", "ca", "au", "de"],
    craigslistCities: ["sfbay", "newyork", "losangeles", "seattle", "boston", "austin", "chicago", "london", "toronto"],
    maxPerSearch: 15,
    maxPerFreeSearch: 50,
    sources: defaultSources(),
    minPay: { amount: 0, currency: "USD", period: "year" },
    dropUnpaid: false,
    homeCity: "",
  },
  caps: { dailySend: 20, apifyMonthlyUsd: 4.5, enrichPerRun: 5, draftPerRun: 8 },
  schedule: { enabled: true, time: "08:00" },
  outreach: {
    followUpDays: 5,
    callScript:
      "Hi {contact}, this is {me}. Do you have 30 seconds?\n\n" +
      "I saw {company} is hiring for {role}. {pitch}\n\n" +
      "Are you the right person to talk to about this role, or would a 15-minute call next week make sense? " +
      "If not: can I email you my CV in case something opens up?",
  },
};

export const emptySecrets: Secrets = {
  anthropicKey: "",
  openaiKey: "",
  geminiKey: "",
  xaiKey: "",
  groqKey: "",
  aiKey: "",
  apifyToken: "",
  gmailUser: "",
  gmailAppPassword: "",
  apolloKey: "",
  adzunaAppId: "",
  adzunaKey: "",
  reedKey: "",
  joobleKey: "",
};

async function read<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key));
  return row ? (row.value as T) : null;
}

async function write(key: string, value: unknown) {
  const db = await getDb();
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getSettings(): Promise<AppSettings> {
  const saved = (await read<Partial<AppSettings>>("app")) ?? {};
  return {
    ...defaultSettings,
    ...saved,
    ai: { chain: migrateChain(saved.ai) },
    applyFacts: {
      ...defaultSettings.applyFacts,
      ...migrateFacts(saved.applyAnswers),
      ...saved.applyFacts,
      salary: { ...defaultSettings.applyFacts.salary, ...migrateFacts(saved.applyAnswers).salary, ...saved.applyFacts?.salary },
    },
    search: {
      ...defaultSettings.search,
      ...saved.search,
      // Sources added since the settings were saved start at their default.
      sources: { ...defaultSources(), ...saved.search?.sources },
      minPay: { ...defaultSettings.search.minPay, ...saved.search?.minPay },
    },
    caps: { ...defaultSettings.caps, ...saved.caps },
    schedule: { ...defaultSettings.schedule, ...saved.schedule },
    outreach: { ...defaultSettings.outreach, ...saved.outreach },
  };
}

type LegacyAi = { chain?: Partial<ChainEntry>[]; mode?: string; cliModels?: { write: string; score: string } };

/** Settings saved before the AI chain existed kept one AI; start the chain from it. */
function migrateChain(saved: LegacyAi | undefined): ChainEntry[] {
  if (saved?.chain) return normaliseChain(saved.chain);
  const chain = normaliseChain(DEFAULT_CHAIN);
  const claude = chain.find((e) => e.kind === "claude-cli")!;
  if (saved?.cliModels) Object.assign(claude, saved.cliModels);
  if (saved?.mode === "anthropic") chain.find((e) => e.kind === "anthropic")!.enabled = true;
  return chain;
}

/** Fills facts from the free-text answers saved before facts existed. */
function migrateFacts(answers: { question: string; answer: string }[] | undefined): Partial<ApplyFacts> {
  const out: Partial<ApplyFacts> & { salary?: ApplyFacts["salary"] } = {};
  for (const { question, answer } of answers ?? []) {
    const q = question.toLowerCase();
    const a = answer.trim();
    if (!a) continue;
    const num = Number(a.replace(/[^\d.]/g, ""));
    if (/salary/.test(q) && num > 0) out.salary = { currency: num >= 50_000 ? "PKR" : "USD", target: num, last: 0, floor: 0 };
    else if (/notice/.test(q) && num >= 0) out.noticeDays = /week/i.test(a) ? num * 7 : /month/i.test(a) ? num * 30 : num;
    else if (/authori[sz]/.test(q)) out.authorizedCountries = a.split(/[,;/]| and /).map((c) => c.trim()).filter(Boolean);
    else if (/relocat/.test(q)) out.relocate = /^y/i.test(a);
    else if (/years/.test(q) && num > 0) out.totalYears = String(num);
  }
  return out;
}

export async function saveSettings(next: AppSettings) {
  await write("app", next);
}

export async function getSecrets(): Promise<Secrets> {
  return { ...emptySecrets, ...((await read<Partial<Secrets>>("secrets")) ?? {}) };
}

/** Empty strings in `patch` leave the stored value untouched. */
export async function saveSecrets(patch: Partial<Secrets>, clear: (keyof Secrets)[] = []) {
  const current = await getSecrets();
  const next = { ...current };
  for (const [k, v] of Object.entries(patch) as [keyof Secrets, string][]) {
    if (typeof v === "string" && v.trim()) next[k] = v.trim();
  }
  for (const k of clear) next[k] = "";
  await write("secrets", next);
}

/** What the browser is allowed to know: which keys exist, never their values. */
export async function secretsStatus() {
  const s = await getSecrets();
  return {
    anthropicKey: !!s.anthropicKey,
    openaiKey: !!s.openaiKey,
    geminiKey: !!s.geminiKey,
    xaiKey: !!s.xaiKey,
    groqKey: !!s.groqKey,
    aiKey: !!s.aiKey,
    apifyToken: !!s.apifyToken,
    gmailUser: s.gmailUser,
    gmailAppPassword: !!s.gmailAppPassword,
    apolloKey: !!s.apolloKey,
    adzunaAppId: !!s.adzunaAppId,
    adzunaKey: !!s.adzunaKey,
    reedKey: !!s.reedKey,
    joobleKey: !!s.joobleKey,
  };
}

export async function getProfile(): Promise<Profile> {
  return { ...emptyProfile, ...((await read<Partial<Profile>>("profile")) ?? {}) };
}

export async function saveProfile(profile: Profile) {
  await write("profile", profile);
}

export async function getState<T>(key: string): Promise<T | null> {
  return read<T>(`state:${key}`);
}

export async function setState(key: string, value: unknown) {
  await write(`state:${key}`, value);
}
