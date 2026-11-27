import { describe, expect, it } from "vitest";
import { isLoopbackHost, isTrustedOrigin } from "@/lib/local-request";

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

describe("isTrustedOrigin", () => {
  it("accepts no origin, the extension and loopback pages", () => {
    for (const o of [null, "chrome-extension://abcdef", "http://127.0.0.1:3000", "http://localhost:4000"]) {
      expect(isTrustedOrigin(o)).toBe(true);
    }
  });
  it("rejects other websites and opaque origins", () => {
    for (const o of ["https://evil.example", "http://localhost.evil.example", "null", "file://"]) {
      expect(isTrustedOrigin(o)).toBe(false);
    }
  });
});
