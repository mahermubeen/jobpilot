import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
