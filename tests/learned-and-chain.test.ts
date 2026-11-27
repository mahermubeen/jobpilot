import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory settings state, so the learned record runs without a database.
const state = new Map<string, unknown>();
vi.mock("@/lib/settings", async (orig) => {
  const real = await orig<typeof import("@/lib/settings")>();
  return {
    ...real,
    getState: async (k: string) => state.get(k) ?? null,
    setState: async (k: string, v: unknown) => void state.set(k, structuredClone(v)),
  };
});

import { DEFAULT_CHAIN, normaliseChain } from "@/lib/ai/catalog";
import { getLearned, learn } from "@/lib/apply/learned";

const you = { by: "you" as const };

describe("learn", () => {
  beforeEach(() => state.clear());

  it("replaces an older answer to the same question, scope and type, keeping its id", async () => {
    await learn([{ ...you, question: "Willing to relocate?", answer: "No", type: "radio", scope: "all" }], 1_000);
    const [first] = await getLearned();
    await learn([{ ...you, question: "Willing to relocate?", answer: "Yes", type: "radio", scope: "all" }], 2_000);
    const list = await getLearned();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: first.id, answer: "Yes", at: 2_000 });
  });

  it("keeps answers apart when the scope or the field type differs", async () => {
    await learn([
      { ...you, question: "Willing to relocate?", answer: "No", type: "radio", scope: "all" },
      { ...you, question: "Willing to relocate?", answer: "Only for this one", type: "text", scope: "all" },
      { ...you, question: "Willing to relocate?", answer: "Yes", type: "radio", scope: "job-1" },
    ]);
    expect((await getLearned()).map((e) => e.answer).sort()).toEqual(["No", "Only for this one", "Yes"]);
  });

  it("lets the last of two same-slot answers in one batch win", async () => {
    await learn([
      { ...you, question: "Notice period?", answer: "2 weeks", type: "text", scope: "all" },
      { ...you, question: "Notice period?", answer: "1 month", type: "text", scope: "all" },
    ]);
    const list = await getLearned();
    expect(list).toHaveLength(1);
    expect(list[0].answer).toBe("1 month");
  });

  it("ignores questions with no usable words and does nothing for an empty list", async () => {
    await learn([]);
    await learn([{ ...you, question: "?!", answer: "x", type: "text", scope: "all" }]);
    expect(await getLearned()).toEqual([]);
  });
});

describe("normaliseChain", () => {
  it("returns the default chain when nothing is saved", () => {
    expect(normaliseChain(undefined)).toEqual(DEFAULT_CHAIN);
  });

  it("keeps the saved order and values, drops unknown and repeated kinds, and appends the rest", () => {
    const out = normaliseChain([
      { kind: "ollama", enabled: true, write: "llama-test" },
      { kind: "not-an-ai" as never, enabled: true },
      { kind: "ollama", enabled: false },
      {},
      { kind: "anthropic", enabled: true },
    ]);
    expect(out.map((e) => e.kind).slice(0, 2)).toEqual(["ollama", "anthropic"]);
    expect(out[0]).toMatchObject({ enabled: true, write: "llama-test", baseUrl: DEFAULT_CHAIN.find((d) => d.kind === "ollama")!.baseUrl });
    expect(out).toHaveLength(DEFAULT_CHAIN.length);
    expect(new Set(out.map((e) => e.kind)).size).toBe(DEFAULT_CHAIN.length);
  });
});
