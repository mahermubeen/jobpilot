import { HttpError } from "@/lib/api";

/**
 * The apply routes hand out CV data, so they answer the app's own pages and
 * the browser extension only. A script on some website that calls the local
 * app is turned away.
 */
export function assertLocalCaller(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || origin.startsWith("chrome-extension://")) return;
  if (origin === new URL(req.url).origin) return;
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {}
  if (host === "127.0.0.1" || host === "localhost") return;
  throw new HttpError(403, "This endpoint only answers JobPilot and its browser extension.");
}
