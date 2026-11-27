import { HttpError } from "@/lib/api";
import { isTrustedOrigin } from "@/lib/local-request";

/**
 * The apply routes hand out CV data, so they answer the app's own pages and
 * the browser extension only, even for GET. A script on some website that
 * calls the local app is turned away. proxy.ts does the same for every write.
 */
export function assertLocalCaller(req: Request) {
  if (!isTrustedOrigin(req.headers.get("origin"))) {
    throw new HttpError(403, "This endpoint only answers JobPilot and its browser extension.");
  }
}
