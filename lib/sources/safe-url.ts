import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { SourceHttpError, USER_AGENT } from "./net";

/**
 * Guards server-side fetches of URLs that come from untrusted data (job links,
 * company websites from scraped posts). Without it, a job post could point the
 * app at 127.0.0.1 (this app's own API), the home network, or a cloud metadata
 * address. Only public http(s) hosts pass, and every redirect hop is checked.
 *
 * Remaining gap: DNS can change between the check and the fetch (rebinding).
 * The fetched text only ever reaches the AI prompt, which limits the impact.
 */

export type Lookup = (host: string) => Promise<string[]>;

const defaultLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

const MAX_REDIRECTS = 3;

// Non-public IPv4 ranges as [first octet, lowest second octet, highest second octet].
const BLOCKED_V4: readonly (readonly [number, number, number])[] = [
  [0, 0, 255], // "this network", 0.0.0.0
  [10, 0, 255],
  [127, 0, 255],
  [100, 64, 127], // carrier-grade NAT
  [169, 254, 254], // link-local, cloud metadata
  [172, 16, 31],
  [192, 168, 168],
  [192, 0, 0], // IETF protocol assignments
  [198, 18, 19], // benchmarking
];
const FIRST_RESERVED_OCTET = 224; // multicast and reserved from here up

function ipv4Blocked(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a >= FIRST_RESERVED_OCTET) return true;
  return BLOCKED_V4.some(([first, lo, hi]) => a === first && b >= lo && b <= hi);
}

function ipv6Blocked(raw: string): boolean {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (ip === "::" || ip === "::1") return true;
  // IPv4-mapped / translated forms: ::ffff:1.2.3.4, ::ffff:7f00:1, 64:ff9b::1.2.3.4
  const mapped = /^(?:::ffff:|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(ip);
  if (mapped) {
    if (mapped[1]) return ipv4Blocked(mapped[1]);
    const hi = parseInt(mapped[2], 16);
    const lo = parseInt(mapped[3], 16);
    return ipv4Blocked(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(ip.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 // multicast
  );
}

/** True when an IP literal is loopback, private, link-local or otherwise not on the public internet. */
export function isBlockedIp(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  const kind = isIP(bare.split("%")[0]);
  if (kind === 4) return ipv4Blocked(bare);
  if (kind === 6) return ipv6Blocked(bare);
  return true; // not an IP at all: refuse rather than guess
}

const LOCAL_SUFFIXES = [".localhost", ".local", ".internal"];

function parseHttpUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Not a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`Refusing ${u.protocol} URL.`);
  if (u.username || u.password) throw new Error("Refusing a URL with credentials.");
  return u;
}

const isLocalHostname = (host: string) => !host || host === "localhost" || LOCAL_SUFFIXES.some((s) => host.endsWith(s));

/** Throws unless `url` is http(s) and every address its host resolves to is public. */
export async function assertPublicUrl(url: string, lookup: Lookup = defaultLookup): Promise<URL> {
  const u = parseHttpUrl(url);
  // WHATWG URL already turns tricks like http://2130706433 or http://0x7f.1 into dotted IPs.
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (isLocalHostname(host)) throw new Error(`Refusing to fetch a local address (${host}).`);
  const addresses = isIP(host) ? [host] : await lookup(host);
  if (!addresses.length || addresses.some(isBlockedIp)) {
    throw new Error(`Refusing to fetch ${host}: it points at a private or local address.`);
  }
  return u;
}

type FetchPublicOptions = { timeoutMs?: number; headers?: Record<string, string>; lookup?: Lookup; fetchImpl?: typeof fetch; maxBytes?: number };

/** The most of a page that is read; callers keep only the first few thousand characters. */
const MAX_BYTES = 2 * 1024 * 1024;

/** A response body as text, reading no more than `maxBytes` and dropping the rest unread. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let left = maxBytes;
  while (left > 0) {
    // eslint-disable-next-line no-await-in-loop -- a stream gives its chunks in order, one read at a time
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    const part = value.byteLength > left ? value.subarray(0, left) : value;
    text += decoder.decode(part, { stream: true });
    left -= part.byteLength;
  }
  await reader.cancel();
  return text + decoder.decode();
}

/** Lets go of a body that will not be read, so its connection is freed. */
const discard = (res: Response) => res.body?.cancel().catch(() => {});

/** The page's text, or an error naming the status when the site did not answer with the page. */
function pageText(res: Response, u: URL, maxBytes: number): Promise<string> {
  if (res.ok) return readCapped(res, maxBytes);
  void discard(res);
  throw new SourceHttpError(`${u.hostname} answered ${res.status}`, res.status);
}

const isRedirect = (status: number) => status >= 300 && status < 400;

/**
 * GETs the text of a public web page. Redirects are followed by hand (at most
 * three) so each hop is checked too. At most `maxBytes` (2 MB) of the page is read.
 */
export async function fetchPublicText(url: string, options: FetchPublicOptions = {}): Promise<string> {
  const { timeoutMs = 30_000, headers = {}, lookup = defaultLookup, fetchImpl = fetch, maxBytes = MAX_BYTES } = options;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Each hop's URL comes from the previous response, so hops cannot run in parallel.
    // eslint-disable-next-line no-await-in-loop -- redirect hops depend on each other
    const u = await assertPublicUrl(current, lookup);
    // eslint-disable-next-line no-await-in-loop -- redirect hops depend on each other
    const res = await fetchImpl(u, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!isRedirect(res.status)) return pageText(res, u, maxBytes);
    void discard(res);
    const next = res.headers.get("location");
    if (!next) throw new SourceHttpError(`${u.hostname} redirected without a location`, res.status);
    current = new URL(next, u).toString();
  }
  throw new Error("Too many redirects.");
}
