import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory settings state, so the learned record and AI chain run without a database.
const state = new Map<string, unknown>();
const settings = { current: null as unknown };
// Keys whose next write fails, to test what happens when bookkeeping breaks.
const failWrites = new Set<string>();
vi.mock("@/lib/settings", async (orig) => {
  const real = await orig<typeof import("@/lib/settings")>();
  return {
    ...real,
    getState: async (k: string) => state.get(k) ?? null,
    setState: async (k: string, v: unknown) => {
      if (failWrites.delete(k)) throw new Error("disk is full");
      state.set(k, structuredClone(v));
    },
    getSettings: async () => settings.current,
    getSecrets: async () => ({ ...real.emptySecrets, openaiKey: "sk-o", geminiKey: "g-k" }),
  };
});

import { defaultSettings, type ApplyFacts } from "@/lib/settings";
import { bankAnswer, experienceTopic, pickNumberOption, techYears, type BankJob } from "@/lib/apply/bank";
import { resolveSalary } from "@/lib/apply/salary";
import { findAnswer, findAnswers, isJobSpecific, getLearned, learn, questionKey } from "@/lib/apply/learned";
import { resolveAnswers } from "@/lib/apply/resolve";
import { trimToSentences, validateAnswer, type FormField } from "@/lib/apply/answers";
import { chainProvider, classify, getParked, getUsage } from "@/lib/ai/chain";
import { metered, recordCall } from "@/lib/ai/meter";
import { AiHttpError } from "@/lib/ai/http";
import { normaliseChain } from "@/lib/ai/catalog";
import { emptyProfile, type Profile } from "@/lib/cv/types";

const profile: Profile = {
  ...emptyProfile,
  name: "Alex Doe",
  email: "m@example.com",
  phone: "+1 555 0102",
  location: "Islamabad, Pakistan",
  education: [{ school: "Example University", degree: "BS in Software Engineering", start: "2017", end: "May 2021" }],
  experience: [
    { company: "Acme Corp", title: "Full Stack Engineer", location: "", start: "Jan 2025", end: "Present", bullets: ["Built React and Node.js apps"] },
    { company: "Globex", title: "Engineer", location: "", start: "Dec 2022", end: "Sept 2025", bullets: ["React Native app and Java services"] },
  ],
};
const facts: ApplyFacts = {
  ...defaultSettings.applyFacts,
  city: "Islamabad",
  country: "Pakistan",
  nationality: "Pakistani",
  authorizedCountries: ["Pakistan"],
  totalYears: "6",
  noticeDays: 3,
  relocate: false,
  salary: { currency: "PKR", target: 500_000, last: 350_000, floor: 180_000 },
  gender: "Male",
  ethnicity: "Asian",
  veteran: "No",
  disability: "No",
};
const usJob: BankJob = { company: "Acme Widgets", role: "Software Engineer", location: "Remote, United States", mode: "Remote", source: "linkedin" };
const pkJob: BankJob = { company: "Globex", role: "Software Engineer", location: "Islamabad, Pakistan", mode: "Onsite", source: "indeed" };
const now = new Date("2026-11-18T00:00:00Z");
const ctx = (job: BankJob = usJob) => ({ profile, facts, job, now });
const F = (label: string, type: FormField["type"] = "text", options?: string[]): FormField => ({ id: "f", label, type, ...(options ? { options } : {}) });
const ans = (f: FormField, job?: BankJob) => {
  const a = bankAnswer(f, ctx(job));
  return a?.skip ? "SKIP" : a?.needsMarket ? "MARKET" : a ? validateAnswer(f, a.value, a.maxWords) : undefined;
};

describe("question bank", () => {
  it("answers work rights per country", () => {
    expect(ans(F("Are you legally authorised to work in Pakistan?", "radio", ["Yes", "No"]))).toBe("Yes");
    expect(ans(F("Are you legally authorized to work in the United States?", "radio", ["Yes", "No"]))).toBe("No");
    expect(ans(F("Will you now or in the future require sponsorship for employment visa status (e.g. H-1B)?", "select", ["Yes", "No"]))).toBe("Yes");
    expect(ans(F("Do you require visa sponsorship?", "radio", ["Yes", "No"]), pkJob)).toBe("No");
    expect(ans(F("Are you authorized to work in the US without sponsorship?", "radio", ["Yes", "No"]))).toBe("No");
  });

  it("ticks consent but leaves marketing opt-ins alone", () => {
    expect(ans(F("I agree to the privacy policy", "checkbox"))).toBe("yes");
    expect(ans(F("I certify that the information provided is true and complete", "checkbox"))).toBe("yes");
    expect(ans(F("Send me job alerts and news about future opportunities", "checkbox"))).toBe("SKIP");
  });

  it("answers location, education and source", () => {
    expect(ans(F("City"))).toBe("Islamabad");
    expect(ans(F("Location"))).toBe("Islamabad, Pakistan");
    expect(ans(F("Highest level of education", "select", ["High school", "Bachelor's degree", "Master's degree"]))).toBe("Bachelor's degree");
    expect(ans(F("Graduation year"))).toBe("2021");
    expect(ans(F("How did you hear about us?", "select", ["LinkedIn", "Indeed", "Other"]))).toBe("LinkedIn");
    expect(ans(F("In which location did you find the job?", "select", ["LinkedIn", "Indeed", "Other"]))).toBe("LinkedIn");
    expect(ans(F("Who referred you?"))).toBe("SKIP");
  });

  it("answers availability", () => {
    expect(ans(F("Notice period", "select", ["Immediately", "2 weeks", "1 month"]))).toBe("Immediately");
    expect(ans(F("Earliest start date", "date"))).toBe("2026-11-21");
    expect(ans(F("Are you willing to relocate?", "radio", ["Yes", "No"]))).toBe("No");
    expect(ans(F("Are you comfortable working remotely?", "radio", ["Yes", "No"]))).toBe("Yes");
    expect(ans(F("Are you 18 years of age or older?", "radio", ["Yes", "No"]))).toBe("Yes");
  });

  it("answers diversity questions truthfully", () => {
    expect(ans(F("Gender", "select", ["Female", "Male", "Decline to self-identify"]))).toBe("Male");
    expect(ans(F("Veteran status", "select", ["I am a protected veteran", "I am not a protected veteran", "I don't wish to answer"]))).toBe("I am not a protected veteran");
    expect(ans(F("Disability status", "radio", ["Yes, I have a disability", "No, I do not have a disability", "I do not want to answer"]))).toBe("No, I do not have a disability");
    expect(ans(F("Race", "select", ["White", "Asian", "Decline"]))).toBe("Asian");
  });

  it("counts years with a technology from the CV, and total years otherwise", () => {
    expect(experienceTopic("How many years of experience do you have with React?")).toBe("React");
    expect(experienceTopic("Years of professional experience")).toBe("");
    expect(techYears("React", profile, now)).toBe(4);
    expect(techYears("Rust", profile, now)).toBeNull();
    expect(ans(F("How many years of experience do you have with Rust?", "number"))).toBeUndefined();
    expect(ans(F("Years of professional experience", "select", ["0-1", "1-3", "3-5", "5-7", "7+"]))).toBe("5-7");
    expect(pickNumberOption(["Less than 1", "1-3", "10+"], 12)).toBe("10+");
  });
});

describe("salary", () => {
  it("asks for the stated maximum, never below the floor", () => {
    const withRange = { ...pkJob, pay: "PKR 250,000 - 450,000 per month" };
    expect(resolveSalary(F("Expected salary (PKR per month)", "number"), facts, withRange)).toMatchObject({ value: "450000" });
    const lowBudget = { ...pkJob, pay: "PKR 80k - 120k per month" };
    expect(resolveSalary(F("Expected salary (PKR per month)", "number"), facts, lowBudget)).toMatchObject({ value: "180000" });
  });
  it("uses the target at home and the market rate abroad", () => {
    expect(resolveSalary(F("What is your expected salary?"), facts, pkJob)).toMatchObject({ value: "500,000 PKR per month" });
    expect(resolveSalary(F("Expected salary", "number"), facts, pkJob)).toMatchObject({ value: "500000" });
    expect(resolveSalary(F("Expected salary (USD, annual)", "number"), facts, usJob)).toEqual({ needsMarket: true });
    expect(resolveSalary(F("Expected salary (USD, annual)", "number"), facts, usJob, 60_000)).toMatchObject({ value: "60000" });
    // A market figure below the floor is raised to it (180k PKR/month ≈ 7,700 USD/year).
    expect(Number((resolveSalary(F("Expected salary (USD, annual)", "number"), facts, usJob, 1000) as { value: string }).value)).toBeGreaterThan(7000);
  });
  it("reports current pay in your own currency", () => {
    expect(resolveSalary(F("What is your current CTC?"), facts, usJob)).toMatchObject({ value: "350,000 PKR per month" });
  });
});

describe("learned answers", () => {
  const entries = [
    { question: "What is your expected salary?", answer: "500000", scope: "all" },
    { question: "Years of experience with React", answer: "4", scope: "all" },
    { question: "Why do you want to work at Acme Widgets?", answer: "Because…", scope: "job-1" },
  ];
  it("matches the same question worded differently, and nothing else", () => {
    expect(findAnswer(F("Expected salary"), entries, "j")?.value).toBe("500000");
    expect(findAnswer(F("How many years of experience do you have with React?"), entries, "j")?.value).toBe("4");
    expect(findAnswer(F("Years of experience with React Native"), entries, "j")).toBeNull();
    expect(findAnswer(F("Current salary"), entries, "j")).toBeNull();
  });
  it("lists the best few remembered answers, each once, in scope", () => {
    const list = [
      { question: "Current location", answer: "Islamabad, PAK", scope: "all" },
      { question: "What is your current location?", answer: "Islamabad, Pakistan", scope: "all" },
      { question: "Current location", answer: "islamabad, pak", scope: "all" },
      { question: "Current location", answer: "Lahore", scope: "other-job" },
    ];
    // Same wording scores the same; "islamabad, pak" is a repeat; Lahore belongs to another job.
    expect(findAnswers(F("What is your current location?"), list, "j").map((h) => h.value).sort()).toEqual(["Islamabad, PAK", "Islamabad, Pakistan"]);
  });

  it("ignores Lever's required marker and dropdown helper text", () => {
    expect(questionKey("Current location ✱No location found. Try entering a different locationLoading")).toBe(questionKey("Current location"));
    const saved = [{ question: "Current location ✱No location found. Try entering a different locationLoading", answer: "Islamabad, PAK", scope: "all" }];
    expect(findAnswer(F("Current location"), saved, "j")?.value).toBe("Islamabad, PAK");
  });

  it("keeps job-specific answers to their job", () => {
    const why = F("Why do you want to work at Acme Widgets?", "textarea");
    expect(findAnswer(why, entries, "job-2")).toBeNull();
    expect(findAnswer(why, entries, "job-1")?.value).toBe("Because…");
    expect(isJobSpecific(why, "Acme Widgets")).toBe(true);
    expect(isJobSpecific(F("Describe a project you are proud of", "textarea"), "Acme Widgets")).toBe(false);
  });
  it("trims open answers at a full sentence", () => {
    expect(trimToSentences("One two three. Four five six. Seven eight.", 6)).toBe("One two three. Four five six.");
    expect(validateAnswer(F("Why?", "textarea"), Array(80).fill("word").join(" ") + ".")).toBeNull();
  });
});

describe("resolveAnswers", () => {
  beforeEach(() => state.clear());
  const job = { ...pkJob, id: "job-1", company: "Globex", role: "Software Engineer" };

  it("makes no AI call when the bank covers every field", async () => {
    const ai = vi.fn();
    const fields = [F("First name"), F("City"), F("I agree to the privacy policy", "checkbox"), F("Expected salary", "number")].map((f, i) => ({ ...f, id: `f${i}` }));
    const { answers, stats } = await resolveAnswers({ profile, facts, saved: [], job, fields }, { answerFormFields: ai, estimateMarketSalary: vi.fn() });
    expect(ai).not.toHaveBeenCalled();
    expect(stats.aiCalls).toBe(0);
    expect(stats.aiName).toBeNull();
    expect(answers.map((a) => a.value)).toEqual(["Alex", "Islamabad", "yes", "500000"]);
    expect(answers.map((a) => a.source)).toEqual(["profile", "bank", "bank", "bank"]);
    expect(answers[2].rule).toBe("consent");
  });

  it("asks the AI once, then remembers", async () => {
    const field = { ...F("Describe your experience with microservices", "textarea"), id: "q" };
    const ai = vi.fn(async () => {
      recordCall({ ai: "Google Gemini", model: "gemini-2.5-flash", tier: "write", purpose: "written answers", inTokens: 1500, outTokens: 60, ms: 900 });
      return new Map([["q", "I split a monolith into five Node.js services at Acme Corp."]]);
    });
    const deps = { answerFormFields: ai, estimateMarketSalary: vi.fn() };
    const first = await resolveAnswers({ profile, facts, saved: [], job, fields: [field] }, deps);
    expect(first.answers[0].source).toBe("ai");
    expect(first.stats).toMatchObject({ aiCalls: 1, inTokens: 1500, outTokens: 60, aiName: "Google Gemini", ai: 1 });
    expect((await getLearned())).toHaveLength(1);
    const second = await resolveAnswers({ profile, facts, saved: [], job: { ...job, id: "job-2" }, fields: [field] }, deps);
    expect(second.answers[0].source).toBe("learned");
    expect(second.stats.aiCalls).toBe(0);
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it("uses an answer you gave yourself before the answer bank", async () => {
    const f = { ...F("Are you willing to relocate?", "radio", ["Yes", "No"]), id: "r" };
    const deps = { answerFormFields: vi.fn(), estimateMarketSalary: vi.fn() };
    expect((await resolveAnswers({ profile, facts, saved: [], job, fields: [f] }, deps)).answers[0]).toMatchObject({ value: "No", source: "bank" });
    await learn([{ question: "Willing to relocate?", answer: "Yes", type: "radio", scope: "all", by: "you" }]);
    expect((await resolveAnswers({ profile, facts, saved: [], job, fields: [f] }, deps)).answers[0]).toMatchObject({ value: "Yes", source: "saved" });
  });

  it("spends AI only on required questions when the form marks any", async () => {
    const req = { ...F("Describe a hard bug you fixed", "textarea"), id: "a", required: true };
    const opt = { ...F("Anything else you want us to know?", "textarea"), id: "b" };
    const ai = vi.fn(async ({ fields: asked }: { fields: FormField[] }) => new Map(asked.map((f) => [f.id, "I traced a memory leak in a Node.js worker and fixed it."])));
    const deps = { answerFormFields: ai, estimateMarketSalary: vi.fn() };
    const { answers } = await resolveAnswers({ profile, facts, saved: [], job, fields: [req, opt] }, deps);
    expect(ai.mock.calls[0][0].fields.map((f: FormField) => f.id)).toEqual(["a"]);
    expect(answers.map((x) => x.source)).toEqual(["ai", "none"]);

    // Nothing marked required: every open question is answered.
    const plain = { ...F("What is your favourite framework and why?", "textarea"), id: "c" };
    await resolveAnswers({ profile, facts, saved: [], job, fields: [plain] }, deps);
    expect(ai.mock.calls[1][0].fields.map((f: FormField) => f.id)).toEqual(["c"]);
  });

  it("suggests from what is known without calling the AI (ai: false)", async () => {
    const ai = vi.fn();
    const estimate = vi.fn();
    const fields = [{ ...F("City"), id: "c", required: true }, { ...F("Describe a hard bug you fixed", "textarea"), id: "d", required: true }];
    const { answers, stats } = await resolveAnswers({ profile, facts, saved: [], job, fields, ai: false }, { answerFormFields: ai, estimateMarketSalary: estimate });
    expect(ai).not.toHaveBeenCalled();
    expect(stats.aiCalls).toBe(0);
    expect(answers.map((a) => [a.value, a.source])).toEqual([["Islamabad", "bank"], [null, "none"]]);
  });

  it("asks the AI about an optional field when told to (Ask AI)", async () => {
    const ai = vi.fn(async ({ fields: asked }: { fields: FormField[] }) => new Map(asked.map((f) => [f.id, "Yes, happy to."])));
    const fields = [{ ...F("Anything else you want us to know?"), id: "o" }, { ...F("City"), id: "c", required: true }];
    const { answers } = await resolveAnswers({ profile, facts, saved: [], job, fields, forceAi: true }, { answerFormFields: ai, estimateMarketSalary: vi.fn() });
    expect(answers[0]).toMatchObject({ source: "ai", value: "Yes, happy to." });
  });

  it("fills an optional question from the record without AI", async () => {
    await learn([{ question: "Portfolio URL", answer: "https://my-folio.example/", type: "url", scope: "all", by: "you" }]);
    const ai = vi.fn();
    const fields = [{ ...F("Portfolio URL", "url"), id: "p" }, { ...F("Notice period (days)", "number"), id: "n", required: true }];
    const { answers } = await resolveAnswers({ profile, facts, saved: [], job, fields }, { answerFormFields: ai, estimateMarketSalary: vi.fn() });
    expect(answers[0]).toMatchObject({ value: "https://my-folio.example/", source: "saved" });
    expect(ai).not.toHaveBeenCalled();
  });

  it("works out a market salary once per role and place", async () => {
    const usJobFull = { ...usJob, id: "job-3", company: "Acme Widgets", role: "Software Engineer" };
    const estimate = vi.fn(async () => 70_000);
    const deps = { answerFormFields: vi.fn(), estimateMarketSalary: estimate };
    const f = { ...F("Expected salary (USD per year)", "number"), id: "s" };
    const first = (await resolveAnswers({ profile, facts, saved: [], job: usJobFull, fields: [f] }, deps)).answers[0];
    expect(first).toMatchObject({ value: "70000", source: "ai", rule: "salary" });
    const second = await resolveAnswers({ profile, facts, saved: [], job: { ...usJobFull, id: "job-4" }, fields: [f] }, deps);
    expect(second.answers[0].source).toBe("learned");
    expect(estimate).toHaveBeenCalledTimes(1);
  });
});

describe("answers built from your own facts", () => {
  const withFacts = (over: Partial<ApplyFacts>, f: FormField) => bankAnswer(f, { profile, facts: { ...facts, ...over }, job: usJob, now });

  it("picks your time zone by its offset, not a hard-coded one", () => {
    const zones = ["(UTC+05:00) Islamabad, Karachi", "(UTC-05:00) Eastern Time (US & Canada)", "(UTC+05:30) Chennai, Mumbai"];
    expect(withFacts({ timezone: "America/New_York" }, F("Time zone", "select", zones))?.value).toBe("(UTC-05:00) Eastern Time (US & Canada)");
    expect(withFacts({ timezone: "PKT (UTC+5)" }, F("Time zone", "select", [zones[2], zones[0]]))?.value).toBe("(UTC+05:00) Islamabad, Karachi");
    expect(withFacts({ timezone: "IST (UTC+05:30)" }, F("Time zone", "select", zones))?.value).toBe("(UTC+05:30) Chennai, Mumbai");
    expect(withFacts({ timezone: "Asia/Karachi" }, F("Time zone", "select", ["Karachi time", "Lisbon time"]))?.value).toBe("Karachi time");
  });

  it("does not guess a time zone you have not set", () => {
    expect(withFacts({ timezone: "" }, F("Time zone", "select", ["(UTC+05:00) Islamabad, Karachi", "(UTC+00:00) London"]))?.value ?? null).toBeNull();
  });

  it("treats your city, region and country as plain text, not patterns", () => {
    expect(withFacts({ city: "St. Mary (East)" }, F("City", "select", ["StX Mary East", "St. Mary (East)"]))?.value).toBe("St. Mary (East)");
    expect(() => withFacts({ region: "New (South" }, F("State", "select", ["New (South Province", "North"]))).not.toThrow();
    expect(() => withFacts({ country: "C++land", nationality: "C++lander" }, F("Nationality", "select", ["C++lander", "Other"]))).not.toThrow();
    expect(() => withFacts({ english: "Fluent (C1" }, F("English level", "select", ["Fluent (C1)", "Basic"]))).not.toThrow();
  });
});

describe("AI chain", () => {
  beforeEach(() => {
    state.clear();
    settings.current = { ...defaultSettings, ai: { chain: normaliseChain(undefined) } };
    vi.unstubAllGlobals();
  });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("classifies failures", () => {
    const now = 1000;
    expect(classify(new AiHttpError("x", 429, "rate limit", 30_000), now)).toMatchObject({ reason: "rate", until: now + 120_000 });
    expect(classify(new AiHttpError("x", 429, '{"error":{"code":"insufficient_quota"}}', null), now).reason).toBe("quota");
    expect(classify(new AiHttpError("x", 401, "bad key", null), now)).toMatchObject({ reason: "auth", until: null });
  });

  it("falls through to the next AI and sets the failed one aside", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("openai.com")) return reply(429, { error: { message: "You exceeded your current quota", code: "insufficient_quota" } });
      return reply(200, { choices: [{ message: { content: "ready" } }], usage: { prompt_tokens: 30, completion_tokens: 2 } });
    }));
    const p = chainProvider();
    const { result, calls: metered1 } = await metered(() => p.complete("hi", { tier: "score", purpose: "short answers" }));
    expect(result).toBe("ready");
    expect(metered1).toEqual([expect.objectContaining({ ai: "Google Gemini", purpose: "short answers", inTokens: 30, outTokens: 2 })]);
    expect((await getUsage()).tokens?.gemini).toEqual({ in: 30, out: 2 });
    expect(p.name).toBe("Google Gemini");
    expect((await getParked()).openai?.reason).toBe("quota");
    // The next call skips OpenAI without asking it.
    await p.complete("hi", { tier: "score" });
    expect(calls.filter((u) => u.includes("openai.com"))).toHaveLength(1);
  });

  it("keeps a good answer, and the AI that gave it, when counting the call fails", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return reply(200, { choices: [{ message: { content: "ready" } }], usage: { prompt_tokens: 30, completion_tokens: 2 } });
    }));
    failWrites.add("aiUsage");
    expect(await chainProvider().complete("hi", { tier: "score" })).toBe("ready");
    // Only the first AI was asked, and it was not set aside.
    expect(calls).toHaveLength(1);
    expect(await getParked()).toEqual({});
  });
});
