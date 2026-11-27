import { describe, expect, it } from "vitest";
import { ago, isOlderThan, toPostedAt } from "@/lib/pipeline/cleanup";

const now = new Date("2026-11-17T12:00:00Z").getTime();
const hoursAgo = (h: number) => new Date(now - h * 36e5).toISOString();

describe("isOlderThan", () => {
  it("goes by the posting date when there is one", () => {
    const job = { status: "Found", postedAt: hoursAgo(50), createdAt: hoursAgo(1) };
    expect(isOlderThan(job, 24, now)).toBe(true);
    expect(isOlderThan(job, 48, now)).toBe(true);
    expect(isOlderThan(job, 72, now)).toBe(false);
  });

  it("falls back to when the job was found", () => {
    expect(isOlderThan({ status: "Found", createdAt: hoursAgo(30) }, 24, now)).toBe(true);
    expect(isOlderThan({ status: "Found", createdAt: hoursAgo(10) }, 24, now)).toBe(false);
    expect(isOlderThan({ status: "Drafted", found: "2026-11-10" }, 72, now)).toBe(true);
  });

  it("never counts jobs you acted on", () => {
    for (const status of ["Applied", "Replied", "Interview", "Offer"]) {
      expect(isOlderThan({ status, postedAt: hoursAgo(500) }, 24, now)).toBe(false);
    }
  });

  it("keeps jobs with no date at all", () => {
    expect(isOlderThan({ status: "Found" }, 24, now)).toBe(false);
  });
});

describe("helpers", () => {
  it("formats ages", () => {
    expect(ago(now - 5 * 36e5, now)).toBe("5h ago");
    expect(ago(now - 50 * 36e5, now)).toBe("2d ago");
  });

  it("reads posted dates from forms and the API", () => {
    expect(toPostedAt("2026-11-16")?.toISOString()).toBe("2026-11-16T12:00:00.000Z");
    expect(toPostedAt("2026-11-16T08:30:00Z")?.toISOString()).toBe("2026-11-16T08:30:00.000Z");
    expect(toPostedAt(null)).toBeNull();
    expect(toPostedAt("nope")).toBeNull();
  });
});
