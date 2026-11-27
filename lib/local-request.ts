/**
 * Who may talk to the local API. JobPilot binds to 127.0.0.1 and has no login,
 * so these checks are what keep other websites out:
 * - Host must be a loopback name (blocks DNS-rebinding reads).
 * - Origin, when sent, must be the app itself, another loopback page or
 *   JobPilot's own extension (blocks cross-site writes, which need no preflight).
 * - Another extension is refused for reads as well (it is not bound by CORS).
 * Pure functions with no imports, so both proxy.ts and route code can use them.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function hostnameOf(value: string): string | null {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

/** True when the Host header names this machine. A missing Host is allowed (not a browser). */
export function isLoopbackHost(host: string | null): boolean {
  if (!host) return true;
  const name = hostnameOf(host);
  return !!name && LOOPBACK.has(name);
}

/**
 * JobPilot's own extension. The public "key" in extension/manifest.json gives
 * the unpacked extension this id on every computer (tests/local-request.test.ts
 * checks they match). A self-packed build can name its id in JOBPILOT_EXTENSION_ID.
 */
export const JOBPILOT_EXTENSION_ID = "amafmfnilbcppofepbddbddgkfahhmig";

const ourExtension = (override: string | undefined) => `chrome-extension://${override?.trim() || JOBPILOT_EXTENSION_ID}`;

/**
 * True when the Origin header is absent, JobPilot's extension, or a loopback
 * page. Every other extension is refused, even though it may run on this computer.
 */
export function isTrustedOrigin(
  origin: string | null,
  extensionId: string | undefined = process.env.JOBPILOT_EXTENSION_ID,
): boolean {
  if (!origin) return true;
  if (origin.startsWith("chrome-extension://")) return origin === ourExtension(extensionId);
  const name = hostnameOf(origin);
  return !!name && origin.startsWith("http") && LOOPBACK.has(name);
}

/**
 * True for a request from an extension other than JobPilot's. Extensions with
 * access to 127.0.0.1 skip the browser's cross-site rules, so these are refused
 * for reads too, not only writes.
 */
export function isForeignExtension(
  origin: string | null,
  extensionId: string | undefined = process.env.JOBPILOT_EXTENSION_ID,
): boolean {
  return !!origin && origin.startsWith("chrome-extension://") && origin !== ourExtension(extensionId);
}
