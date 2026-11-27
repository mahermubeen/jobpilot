import { describe, expect, it, vi } from "vitest";
import { assertPublicUrl, fetchPublicText, isBlockedIp } from "@/lib/sources/safe-url";

// No real DNS: every name resolves to what the test says.
const resolvesTo = (...ips: string[]) => async () => ips;
const PUBLIC = "93.184.215.14";

describe("isBlockedIp", () => {
  it("blocks loopback, private, link-local, CGNAT and reserved IPv4", () => {
    for (const ip of ["127.0.0.1", "127.8.9.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.7", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
  it("blocks local and mapped IPv6", () => {
    for (const ip of ["::1", "::", "[::1]", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "ff02::1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of [PUBLIC, "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });
});

describe("assertPublicUrl", () => {
  it("accepts a public https site", async () => {
    await expect(assertPublicUrl("https://company.example/about", resolvesTo(PUBLIC))).resolves.toBeInstanceOf(URL);
  });

  it("refuses local names and IP literals, including encoded forms", async () => {
    for (const url of [
      "http://localhost:3000/api/settings",
      "http://app.localhost/",
      "http://127.0.0.1:3000/",
      "http://2130706433/", // 127.0.0.1 as a number
      "http://0x7f.1/",
      "http://[::1]:3000/",
      "http://169.254.169.254/latest/meta-data/",
      "http://printer.local/",
    ]) {
      await expect(assertPublicUrl(url, resolvesTo(PUBLIC)), url).rejects.toThrow();
    }
  });

  it("refuses a public-looking name that resolves to a private address", async () => {
    await expect(assertPublicUrl("https://evil.example/", resolvesTo(PUBLIC, "10.0.0.2"))).rejects.toThrow(/private or local/);
  });

  it("refuses other schemes and embedded credentials", async () => {
    for (const url of ["file:///etc/passwd", "ftp://files.example/", "javascript:alert(1)", "https://user:pw@company.example/"]) {
      await expect(assertPublicUrl(url, resolvesTo(PUBLIC)), url).rejects.toThrow();
    }
  });
});

describe("fetchPublicText", () => {
  it("returns the body of a public page", async () => {
    const fetchImpl = vi.fn(async () => new Response("hello", { status: 200 }));
    await expect(fetchPublicText("https://company.example/", { lookup: resolvesTo(PUBLIC), fetchImpl })).resolves.toBe("hello");
  });

  it("checks every redirect hop and stops at a private one", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:3000/api/profile" } }));
    await expect(fetchPublicText("https://company.example/", { lookup: resolvesTo(PUBLIC), fetchImpl })).rejects.toThrow(/local address/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  /** A body of `chunks` pieces of `size` bytes each, recording how much was read and whether it was cancelled. */
  const streamed = (chunks: number, size: number) => {
    const seen = { pulled: 0, cancelled: false };
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (seen.pulled >= chunks) return c.close();
        seen.pulled++;
        c.enqueue(new Uint8Array(size).fill(97));
      },
      cancel() {
        seen.cancelled = true;
      },
    });
    return { body, seen };
  };

  it("stops reading a huge page at the size cap", async () => {
    const { body, seen } = streamed(80, 64 * 1024); // 5 MB on offer
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    const text = await fetchPublicText("https://company.example/", { lookup: resolvesTo(PUBLIC), fetchImpl, maxBytes: 256 * 1024 });
    expect(text.length).toBe(256 * 1024);
    expect(seen.pulled).toBeLessThan(10);
    expect(seen.cancelled).toBe(true);
  });

  it("reads a page under the cap whole, with the default cap", async () => {
    const { body } = streamed(3, 1000);
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    expect(await fetchPublicText("https://company.example/", { lookup: resolvesTo(PUBLIC), fetchImpl })).toBe("a".repeat(3000));
  });

  it("drops the body of a redirect and of an error page", async () => {
    const redirect = streamed(5, 10);
    const error = streamed(5, 10);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(redirect.body, { status: 302, headers: { location: "/next" } }))
      .mockResolvedValueOnce(new Response(error.body, { status: 500 }));
    await expect(fetchPublicText("https://company.example/", { lookup: resolvesTo(PUBLIC), fetchImpl })).rejects.toThrow(/answered 500/);
    expect([redirect.seen.cancelled, error.seen.cancelled]).toEqual([true, true]);
  });

  it("gives up after three redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 301, headers: { location: "/again" } }));
    await expect(fetchPublicText("https://company.example/", { lookup: resolvesTo(PUBLIC), fetchImpl })).rejects.toThrow(/Too many redirects/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
