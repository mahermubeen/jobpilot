/**
 * Who may talk to the local API. JobPilot binds to 127.0.0.1 and has no login,
 * so these checks are what keep other websites out:
 * - Host must be a loopback name (blocks DNS-rebinding reads).
 * - Origin, when sent, must be the app itself, another loopback page or the
 *   browser extension (blocks cross-site writes, which need no preflight).
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

/** True when the Origin header is absent, the extension, or a loopback page. */
export function isTrustedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  const name = hostnameOf(origin);
  return !!name && origin.startsWith("http") && LOOPBACK.has(name);
}
