import { describe, expect, it } from "vitest";
import { parsePosted, postedTooLongAgo } from "@/lib/sources/posted";

const now = new Date("2026-11-17T12:00:00Z");
const hoursAgo = (d: Date | null) => (d ? Math.round((now.getTime() - d.getTime()) / 36e5) : null);

describe("parsePosted", () => {
  it("reads ISO timestamps and epoch numbers", () => {
    expect(hoursAgo(parsePosted("2026-11-16T12:00:00Z", now))).toBe(24);
    expect(hoursAgo(parsePosted(now.getTime() - 5 * 36e5, now))).toBe(5);
    expect(hoursAgo(parsePosted(String(Math.floor(now.getTime() / 1000) - 3600), now))).toBe(1);
  });

  it("treats a bare date as the end of that day", () => {
    expect(parsePosted("2026-11-16", now)?.toISOString()).toBe("2026-11-16T23:59:59.000Z");
  });

  it("reads relative text", () => {
    expect(hoursAgo(parsePosted("Just posted", now))).toBe(0);
    expect(hoursAgo(parsePosted("Today", now))).toBe(0);
    expect(hoursAgo(parsePosted("5 hours ago", now))).toBe(5);
    expect(hoursAgo(parsePosted("Posted 3 days ago", now))).toBe(72);
    expect(hoursAgo(parsePosted("30+ days ago", now))).toBe(720);
    expect(hoursAgo(parsePosted("1 week ago", now))).toBe(168);
    expect(hoursAgo(parsePosted("a month ago", now))).toBe(720);
  });

  it("returns null for anything else", () => {
    expect(parsePosted("", now)).toBeNull();
    expect(parsePosted("soon", now)).toBeNull();
    expect(parsePosted(undefined, now)).toBeNull();
  });
});

describe("postedTooLongAgo", () => {
  it("drops jobs older than the window", () => {
    expect(postedTooLongAgo("2 days ago", 1, now)).toBe(true);
    expect(postedTooLongAgo("2 days ago", 3, now)).toBe(false);
    expect(postedTooLongAgo("30+ days ago", 7, now)).toBe(true);
    expect(postedTooLongAgo("2026-11-08", 7, now)).toBe(true);
  });

  it("keeps recent and undated jobs", () => {
    expect(postedTooLongAgo("2026-11-16", 1, now)).toBe(false);
    expect(postedTooLongAgo("20 hours ago", 1, now)).toBe(false);
    expect(postedTooLongAgo(undefined, 1, now)).toBe(false);
    expect(postedTooLongAgo("Recently", 1, now)).toBe(false);
  });
});
