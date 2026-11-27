import type { NextConfig } from "next";

// Defence in depth for a local app: no framing (clickjacking), no MIME sniffing,
// no referrer leaks to job sites, no device APIs.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // These packages rely on Node APIs (filesystem, sockets, WASM) and must not be bundled.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "apify-client",
    "imapflow",
    "nodemailer",
    "unpdf",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
