import type { SearchLocation } from "@/lib/settings";
import type { PostedWithin } from "./posted";

/** What every source gets to search with. */
export type SourceContext = {
  /** Every title to look for: the user's own plus the AI variants. */
  titles: string[];
  /** A shorter list (own titles plus the top variants) for searches that cost time or money per title. */
  boardTitles: string[];
  locations: SearchLocation[];
  postedWithinDays: PostedWithin;
  /** Most jobs per search on free sources. */
  limit: number;
  /** Most jobs per search on paid Apify sources. */
  apifyLimit: number;
  excludeTitleWords: string[];
  log: (line: string) => void;
};

// Says plainly who is asking; no browser disguise.
export const USER_AGENT = "JobPilot/1.0 (personal job search app)";

export class SourceHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchText(
  url: string,
  { timeoutMs = 30_000, headers = {}, body }: { timeoutMs?: number; headers?: Record<string, string>; body?: unknown } = {},
): Promise<string> {
  const res = await fetch(url, {
    // A body makes it a JSON POST.
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json, application/xml, text/xml, */*",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new SourceHttpError(`${new URL(url).hostname} answered ${res.status}`, res.status);
  return res.text();
}

export async function fetchJson<T>(url: string, opts?: Parameters<typeof fetchText>[1]): Promise<T> {
  return JSON.parse(await fetchText(url, opts)) as T;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#x2F": "/" };

export const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => ENTITIES[n] ?? m);

/** HTML to readable plain text, keeping paragraph and list breaks. */
export function stripHtml(html: string | null | undefined): string {
  return decodeEntities(
    (html ?? "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\s*(br|p|\/p|div|\/div|\/li|\/h\d)(\s[^>]*)?\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Runs `fn` over `items`, at most `limit` at a time, keeping order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      // Each worker runs its items one after another; `limit` workers run in parallel.
      // eslint-disable-next-line no-await-in-loop -- this is the concurrency pool itself
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

const PAY_UNITS = ["hour", "day", "week", "month"] as const;

/** The pay period named in `period`, defaulting to "year". */
const payUnit = (period: unknown) => {
  const per = String(period ?? "").toLowerCase();
  return PAY_UNITS.find((u) => per.includes(u)) ?? "year";
};

const payAmount = (lo: number, hi: number) => (lo && hi && lo !== hi ? `${lo} - ${hi}` : String(hi || lo));

/** "USD 90000 - 120000 per year" from numbers, or "" when no amount is given. */
export function payText(min: unknown, max: unknown, currency: unknown, period: unknown): string {
  const lo = Number(min) || 0;
  const hi = Number(max) || 0;
  if (!lo && !hi) return "";
  return `${str(currency) || "USD"} ${payAmount(lo, hi)} per ${payUnit(period)}`;
}

export const saysRemote = (text: string) => /\b(remote|anywhere|worldwide|work from home|wfh)\b/i.test(text);

/** An ISO date from a date string or epoch seconds/milliseconds, or undefined when unreadable. */
export function isoDate(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : /^\d{9,13}$/.test(String(v)) ? Number(v) : NaN;
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
