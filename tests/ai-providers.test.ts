import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeCliUsage } from "@/lib/ai/claude-cli";
import { parseGeminiOutput } from "@/lib/ai/gemini-cli";
import { inCallSlot, metered, recordCall } from "@/lib/ai/meter";
import { listOllamaModels, ollamaProvider } from "@/lib/ai/ollama";
import { openAiCompatibleProvider } from "@/lib/ai/openai-compatible";

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("parseGeminiOutput", () => {
  it("reads the response field", () => {
    expect(parseGeminiOutput('{"response":"ready","stats":{}}')).toMatchObject({ response: "ready", error: undefined, inTokens: 0 });
  });
  it("ignores log lines around the JSON", () => {
    const out = 'Loaded cached credentials.\n{"response":"{\\"a\\":1}","stats":{}}\n';
    expect(parseGeminiOutput(out).response).toBe('{"a":1}');
  });
  it("reports the error message", () => {
    expect(parseGeminiOutput('{"error":{"message":"Quota exceeded"}}')).toMatchObject({ response: undefined, error: "Quota exceeded" });
  });
  it("returns nothing for non-JSON output", () => {
    expect(parseGeminiOutput("Please sign in")).toEqual({});
  });
});

describe("ollamaProvider", () => {
  it("sends the tier's model and returns the message", async () => {
    const fetchMock = vi.fn(async () => reply({ message: { content: " hello " } }));
    vi.stubGlobal("fetch", fetchMock);
    const text = await ollamaProvider("http://127.0.0.1:11434/", { write: "qwen3:8b", score: "llama3.2" }).complete("hi", { tier: "score" });
    expect(text).toBe("hello");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "llama3.2", stream: false });
  });
  it("asks for a model when none is picked", async () => {
    await expect(ollamaProvider("", { write: "", score: "" }).complete("hi", { tier: "write" })).rejects.toThrow(/Pick an Ollama model/);
  });
  it("explains when Ollama is not running", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(ollamaProvider("", { write: "m", score: "m" }).complete("hi", { tier: "write" })).rejects.toThrow(/not running/);
  });
  it("lists installed models, or null when unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ models: [{ name: "qwen3:8b" }, { name: "gemma3:12b" }] })));
    expect(await listOllamaModels()).toEqual(["gemma3:12b", "qwen3:8b"]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await listOllamaModels()).toBeNull();
  });
});

describe("openAiCompatibleProvider", () => {
  it("posts to chat/completions with the key", async () => {
    const fetchMock = vi.fn(async () => reply({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const p = openAiCompatibleProvider("https://api.example.com/v1/", "k-123", { write: "big", score: "small" });
    expect(await p.complete("hi", { tier: "write" })).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k-123");
    expect(JSON.parse(init.body as string).model).toBe("big");
  });
  it("surfaces the server's error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { message: "API key not valid" } }, 400)));
    const p = openAiCompatibleProvider("https://api.example.com/v1", "bad", { write: "m", score: "m" });
    await expect(p.complete("hi", { tier: "write" })).rejects.toThrow(/400: API key not valid/);
  });
});

describe("token counts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads Claude Code usage, counting cached prompt tokens as input", () => {
    const u = claudeCliUsage({
      result: "ok",
      usage: { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 200, output_tokens: 42 },
      modelUsage: { "claude-haiku-5-5": {} },
    });
    expect(u).toEqual({ model: "claude-haiku-5-5", inTokens: 1210, outTokens: 42 });
  });

  it("reads Gemini CLI stats", () => {
    const out = JSON.stringify({ response: "ok", stats: { models: { "gemini-2.5-flash": { tokens: { prompt: 900, candidates: 30, thoughts: 5 } } } } });
    expect(parseGeminiOutput(out)).toMatchObject({ model: "gemini-2.5-flash", inTokens: 900, outTokens: 35 });
  });

  it("reads OpenAI-style usage inside a call slot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      model: "gpt-5-mini-2026",
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 120, completion_tokens: 8 },
    }))));
    const p = openAiCompatibleProvider("https://x.test/v1", "k", { write: "w", score: "gpt-5-mini" });
    const { result, slot } = await inCallSlot(() => p.complete("q", { tier: "score" }));
    expect(result).toBe("hi");
    expect(slot).toEqual({ model: "gpt-5-mini-2026", inTokens: 120, outTokens: 8 });
  });

  it("reads Ollama counts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: { content: "hi" }, prompt_eval_count: 50, eval_count: 4 }))));
    const { slot } = await inCallSlot(() => ollamaProvider("http://o.test", { write: "m", score: "m" }).complete("q", { tier: "score" }));
    expect(slot).toMatchObject({ inTokens: 50, outTokens: 4 });
  });

  it("meters calls made inside a piece of work only", async () => {
    const call = { ai: "X", model: "m", tier: "score" as const, purpose: "p", inTokens: 1, outTokens: 1, ms: 1 };
    recordCall(call);
    const { calls } = await metered(async () => {
      await Promise.resolve();
      recordCall(call);
    });
    expect(calls).toHaveLength(1);
  });
});
