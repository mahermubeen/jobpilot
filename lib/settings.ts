import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { emptyProfile, type Profile } from "@/lib/cv/types";
import type { MinPay } from "@/lib/pay";

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

export type AppSettings = {
  setupDone: boolean;
  ai: {
    /** claude-cli uses the `claude` command on this machine; anthropic uses an API key. */
    mode: "claude-cli" | "anthropic";
    cliModels: { write: string; score: string };
    apiModels: { write: string; score: string };
  };
  search: {
    titles: string[];
    locations: SearchLocation[];
    excludeTitleWords: string[];
    postedWithinDays: 1 | 7 | 30;
    maxPerSearch: number;
    sources: { linkedin: boolean; indeed: boolean; google: boolean };
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
  /** Standing answers for application forms, used by the browser extension. */
  applyAnswers: { question: string; answer: string }[];
};

export type Secrets = {
  anthropicKey: string;
  apifyToken: string;
  gmailUser: string;
  gmailAppPassword: string;
  apolloKey: string;
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
  ai: {
    mode: "claude-cli",
    cliModels: { write: "opus", score: "haiku" },
    apiModels: { write: "claude-opus-5-5", score: "claude-haiku-4-5" },
  },
  search: {
    titles: [],
    locations: [],
    excludeTitleWords: ["intern", "unpaid", "volunteer"],
    postedWithinDays: 7,
    maxPerSearch: 15,
    sources: { linkedin: true, indeed: true, google: true },
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
  apifyToken: "",
  gmailUser: "",
  gmailAppPassword: "",
  apolloKey: "",
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
    ai: { ...defaultSettings.ai, ...saved.ai },
    search: {
      ...defaultSettings.search,
      ...saved.search,
      sources: { ...defaultSettings.search.sources, ...saved.search?.sources },
      minPay: { ...defaultSettings.search.minPay, ...saved.search?.minPay },
    },
    caps: { ...defaultSettings.caps, ...saved.caps },
    schedule: { ...defaultSettings.schedule, ...saved.schedule },
    outreach: { ...defaultSettings.outreach, ...saved.outreach },
  };
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
    apifyToken: !!s.apifyToken,
    gmailUser: s.gmailUser,
    gmailAppPassword: !!s.gmailAppPassword,
    apolloKey: !!s.apolloKey,
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
