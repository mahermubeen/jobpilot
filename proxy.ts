import { NextResponse, type NextRequest } from "next/server";
import { isLoopbackHost, isTrustedOrigin } from "@/lib/local-request";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Turns away API calls from other websites. See lib/local-request.ts. */
export function proxy(req: NextRequest) {
  if (!isLoopbackHost(req.headers.get("host"))) {
    return NextResponse.json({ error: "JobPilot only answers on localhost." }, { status: 403 });
  }
  if (!SAFE_METHODS.has(req.method) && !isTrustedOrigin(req.headers.get("origin"))) {
    return NextResponse.json(
      { error: "This endpoint only answers JobPilot and its browser extension." },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
