import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompleteOpts } from "@/lib/ai/provider";
import type { Profile } from "@/lib/cv/types";

const sent = vi.hoisted(() => ({ requests: [] as Record<string, unknown>[], replies: [] as string[] }));
const chain = vi.hoisted(() => ({ calls: [] as { prompt: string; opts: CompleteOpts }[], replies: [] as string[] }));

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    static AuthenticationError = class extends Error {};
    static PermissionDeniedError = class extends Error {};
    static NotFoundError = class extends Error {};
    static RateLimitError = class extends Error {};
    static APIConnectionError = class extends Error {};
    static APIError = class extends Error {};
    beta = {
      messages: {
        stream: (req: Record<string, unknown>) => {
          sent.requests.push(req);
          return {
            finalMessage: async () => ({
              model: String(req.model),
              stop_reason: "end_turn",
              content: [{ type: "text", text: sent.replies.shift() ?? "ok" }],
              usage: { input_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 600, output_tokens: 5 },
            }),
          };
        },
      },
    };
  }
  return { default: FakeAnthropic };
});

vi.mock("@/lib/ai/chain", () => ({
  chainProvider: () => ({
    name: "fake",
    complete: async (prompt: string, opts: CompleteOpts) => {
      chain.calls.push({ prompt, opts });
      return chain.replies.shift() ?? "[]";
    },
  }),
}));

const { anthropicProvider, userContent } = await import("@/lib/ai/anthropic");
const { inCallSlot, sumCalls } = await import("@/lib/ai/meter");
const { completeJson } = await import("@/lib/ai/provider");
const { scoreJobs } = await import("@/lib/ai/tasks");

const profile: Profile = {
  name: "Sam Rivera",
  headline: "Full Stack Engineer",
  email: "sam@example.com",
  phone: "+1 555 0100",
  location: "Lisbon",
  links: [],
  summary: "Builds web apps.",
  skills: [{ category: "Languages", items: ["TypeScript"] }],
  experience: [{ company: "Acme", title: "Engineer", location: "Lisbon", start: "2020", end: "Present", bullets: ["Shipped things"] }],
  projects: [],
  education: [],
};

beforeEach(() => {
  sent.requests.length = 0;
  sent.replies.length = 0;
  chain.calls.length = 0;
  chain.replies.length = 0;
});

describe("userContent", () => {
  it("splits the stable start into a cached block", () => {
    expect(userContent("ABCdef", 3)).toEqual([
      { type: "text", text: "ABC", cache_control: { type: "ephemeral" } },
      { type: "text", text: "def" },
    ]);
  });

  it.each([undefined, 0, -1, 6, 99, 2.5, Number.NaN])("sends the plain prompt for cacheUpTo=%s", (n) => {
    expect(userContent("ABCdef", n)).toBe("ABCdef");
  });

  it("sends the plain prompt when it is empty", () => {
    expect(userContent("", 3)).toBe("");
  });
});

describe("anthropicProvider caching", () => {
  it("puts a cache breakpoint on the stable start and meters cache reads", async () => {
    const p = anthropicProvider("k", { write: "claude-sonnet-5-5", score: "claude-haiku-5-5" });
    const { result, slot } = await inCallSlot(() => p.complete("STABLE|rest", { tier: "score", cacheUpTo: 7 }));
    expect(result).toBe("ok");
    const messages = sent.requests[0].messages as { content: unknown }[];
    expect(messages[0].content).toEqual([
      { type: "text", text: "STABLE|", cache_control: { type: "ephemeral" } },
      { type: "text", text: "rest" },
    ]);
    expect(slot).toEqual({ model: "claude-haiku-5-5", inTokens: 620, outTokens: 5, cachedTokens: 600 });
  });

  it("leaves requests without a stable start unchanged", async () => {
    const p = anthropicProvider("k", { write: "claude-sonnet-5-5", score: "claude-haiku-5-5" });
    await p.complete("just text", { tier: "write" });
    expect((sent.requests[0].messages as { content: unknown }[])[0].content).toBe("just text");
  });
});

describe("meter", () => {
  it("totals cached tokens and treats missing ones as zero", () => {
    const base = { ai: "X", model: "m", tier: "score" as const, purpose: "p", inTokens: 10, outTokens: 1, ms: 1 };
    expect(sumCalls([{ ...base, cachedTokens: 8 }, base])).toEqual({ calls: 2, inTokens: 20, outTokens: 2, cachedTokens: 8 });
  });
});

describe("completeJson", () => {
  it("keeps the cached start on the repair retry", async () => {
    chain.replies.push("not json", '{"ok": true}');
    await expect(completeJson("STABLE|ask", "score", "p", 7)).resolves.toEqual({ ok: true });
    expect(chain.calls).toHaveLength(2);
    expect(chain.calls[1].opts.cacheUpTo).toBe(7);
    expect(chain.calls[1].prompt.startsWith("STABLE|")).toBe(true);
  });
});

describe("scoreJobs", () => {
  const job = (id: string) => ({ id, company: `Co ${id}`, role: "Engineer", location: "Remote", pay: null, description: `About ${id}` });
  const targets = { titles: ["Engineer"], locations: ["Remote"], minPay: "$50k" };

  it("sends the same cacheable start for every batch and the jobs after it", async () => {
    chain.replies.push('[{"id":"a","fit":"Strong","score":80,"flags":[],"reason":"r"}]', "[]");
    const first = await scoreJobs(profile, [job("a")], targets);
    await scoreJobs(profile, [job("b"), job("c")], targets);

    expect(first).toEqual([{ id: "a", fit: "Strong", score: 80, flags: [], reason: "r" }]);
    const [one, two] = chain.calls;
    const cut1 = one.opts.cacheUpTo!;
    const cut2 = two.opts.cacheUpTo!;
    expect(cut1).toBeGreaterThan(0);
    expect(one.prompt.slice(0, cut1)).toBe(two.prompt.slice(0, cut2));
    expect(one.prompt.slice(0, cut1)).toContain("<candidate>");
    expect(one.prompt.slice(0, cut1)).not.toContain("Co a");
    expect(one.prompt.slice(cut1)).toContain("Co a");
    expect(two.prompt.slice(cut2)).toContain("Co c");
  });
});
