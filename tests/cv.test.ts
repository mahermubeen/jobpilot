import { describe, expect, it } from "vitest";
import { extractJson } from "@/lib/ai/json";
import type { Profile } from "@/lib/cv/types";
import { cvFileName, sanitizeVariant } from "@/lib/cv/variant";

const profile: Profile = {
  name: "Sam Lee",
  headline: "Full Stack Engineer",
  email: "sam@example.com",
  phone: "",
  location: "Lahore",
  links: [],
  summary: "Engineer with web and mobile experience.",
  experience: [
    { company: "Alpha", title: "Engineer", location: "Remote", start: "2023", end: "Present", bullets: ["Built APIs in Flask.", "Shipped a React Native app."] },
    { company: "Beta", title: "Developer", location: "Lahore", start: "2021", end: "2023", bullets: ["Cut load times by 25%."] },
  ],
  projects: [{ name: "Kite", description: "", tech: "React", url: "" }],
  skills: [{ category: "Frontend", items: ["React", "Vue"] }, { category: "Backend", items: ["Flask"] }],
  education: [],
};

describe("sanitizeVariant", () => {
  it("drops bullets, skills and projects that are not in the master CV", () => {
    const v = sanitizeVariant(profile, {
      headline: "React Native Engineer",
      summary: "Short.",
      experience: [
        { company: "Alpha", bullets: ["Shipped a React Native app.", "Led a team of 40 engineers."] },
      ],
      skills: [{ category: "Core", items: ["React", "Kubernetes", "Flask"] }],
      projects: ["Kite", "Invented Project"],
    });
    expect(v.experience[0].bullets).toEqual(["Shipped a React Native app."]);
    expect(v.skills).toEqual([{ category: "Core", items: ["React", "Flask"] }]);
    expect(v.projects).toEqual(["Kite"]);
  });

  it("rejects reworded bullets and falls back to the master bullets", () => {
    const v = sanitizeVariant(profile, {
      experience: [{ company: "Beta", bullets: ["Cut load times by 60%."] }],
    });
    expect(v.experience[1].bullets).toEqual(["Cut load times by 25%."]);
  });

  it("returns the full master CV when there is no variant", () => {
    const v = sanitizeVariant(profile, null);
    expect(v.experience.map((e) => e.bullets.length)).toEqual([2, 1]);
    expect(v.skills).toEqual(profile.skills);
    expect(v.headline).toBe("Full Stack Engineer");
  });
});

describe("cvFileName", () => {
  it("builds a clean file name", () => {
    expect(cvFileName(profile, "Sr. Engineer (AI)", "Acme, Inc.")).toBe("Sam-Lee-Sr-Engineer-AI-Acme-Inc.pdf");
  });
});

describe("extractJson", () => {
  it("reads plain, fenced and wrapped JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n[1,2]\n```')).toEqual([1, 2]);
    expect(extractJson('Here you go: {"ok":true} Hope that helps.')).toEqual({ ok: true });
  });
  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
