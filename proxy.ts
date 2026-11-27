import { NextResponse, type NextRequest } from "next/server";
import { isForeignExtension, isLoopbackHost, isTrustedOrigin } from "@/lib/local-request";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Turns away API calls from other websites. See lib/local-request.ts. */
export function proxy(req: NextRequest) {
  if (!isLoopbackHost(req.headers.get("host"))) {
    return NextResponse.json({ error: "JobPilot only answers on localhost." }, { status: 403 });
  }
  const origin = req.headers.get("origin");
  if (isForeignExtension(origin) || (!SAFE_METHODS.has(req.method) && !isTrustedOrigin(origin))) {
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
