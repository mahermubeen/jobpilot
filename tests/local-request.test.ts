import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isForeignExtension, isLoopbackHost, isTrustedOrigin, JOBPILOT_EXTENSION_ID } from "@/lib/local-request";
import { proxy } from "@/proxy";

const OURS = `chrome-extension://${JOBPILOT_EXTENSION_ID}`;
const OTHER = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

describe("isLoopbackHost", () => {
  it("accepts loopback names with or without a port", () => {
    for (const h of ["127.0.0.1:3000", "localhost:3000", "localhost", "[::1]:3000", null]) {
      expect(isLoopbackHost(h)).toBe(true);
    }
  });
  it("rejects other hosts (DNS rebinding)", () => {
    for (const h of ["evil.example", "evil.example:3000", "127.0.0.1.evil.example", "192.168.1.7:3000"]) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });
});

describe("JobPilot's extension id", () => {
  it("is the id Chrome gives the key in extension/manifest.json", () => {
    // Chrome: the first 16 bytes of sha256(public key DER), each hex digit 0-f written as a-p.
    const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../extension/manifest.json"), "utf8")) as { key: string };
    const hex = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
    const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
    expect(id).toBe(JOBPILOT_EXTENSION_ID);
  });
});

describe("isTrustedOrigin", () => {
  it("accepts no origin, JobPilot's extension and loopback pages", () => {
    for (const o of [null, OURS, "http://127.0.0.1:3000", "http://localhost:4000"]) {
      expect(isTrustedOrigin(o)).toBe(true);
    }
  });
  it("rejects other extensions, other websites and opaque origins", () => {
    for (const o of [OTHER, "https://evil.example", "http://localhost.evil.example", "null", "file://"]) {
      expect(isTrustedOrigin(o)).toBe(false);
    }
  });
  it("trusts a self-packed build named in JOBPILOT_EXTENSION_ID instead", () => {
    expect(isTrustedOrigin("chrome-extension://mybuildid", "mybuildid")).toBe(true);
    expect(isTrustedOrigin(OURS, "mybuildid")).toBe(false);
    expect(isTrustedOrigin(OURS, "  ")).toBe(true);
  });
});

describe("isForeignExtension", () => {
  it("is true only for an extension that is not JobPilot's", () => {
    expect(isForeignExtension(OTHER)).toBe(true);
    for (const o of [OURS, null, "http://127.0.0.1:3000", "https://evil.example"]) expect(isForeignExtension(o)).toBe(false);
  });
});

describe("proxy", () => {
  const call = (method: string, headers: Record<string, string>) =>
    proxy(new NextRequest("http://127.0.0.1:3000/api/apply/cv", { method, headers: { host: "127.0.0.1:3000", ...headers } }));

  it("refuses another extension even for reads", () => {
    expect(call("GET", { origin: OTHER }).status).toBe(403);
    expect(call("POST", { origin: OTHER }).status).toBe(403);
  });
  it("lets the app, JobPilot's extension and plain requests through", () => {
    for (const headers of [{}, { origin: OURS }, { origin: "http://127.0.0.1:3000" }] as Record<string, string>[]) {
      expect(call("GET", headers).status).toBe(200);
      expect(call("POST", headers).status).toBe(200);
    }
  });
  it("refuses writes from other websites and any other host", () => {
    expect(call("POST", { origin: "https://evil.example" }).status).toBe(403);
    expect(call("GET", { host: "evil.example" }).status).toBe(403);
  });
});
