/**
 * Every AI JobPilot can use, in one list the server and the Settings page
 * share. Settings keeps an ordered chain of these; each AI task goes to the
 * first one that is set up and not out of credits.
 */

export type AiKind =
  | "openai"
  | "gemini"
  | "xai"
  | "groq"
  | "claude-cli"
  | "anthropic"
  | "ollama"
  | "gemini-cli"
  | "custom";

export type AiKeyName = "openaiKey" | "geminiKey" | "xaiKey" | "groqKey" | "anthropicKey" | "aiKey";

/** One AI in the chain. "write" drafts CVs, letters and answers; "score" is the cheap model for bulk work. */
export type ChainEntry = { kind: AiKind; enabled: boolean; write: string; score: string; baseUrl?: string };

export type AiInfo = {
  name: string;
  about: string;
  /** Which saved secret holds its API key. None for local tools. */
  keyName?: AiKeyName;
  keyUrl?: string;
  /** Fixed OpenAI-style endpoint. */
  baseUrl?: string;
  write: string;
  score: string;
  /** Where the model list comes from once it is set up. */
  models: "openai" | "ollama" | "fixed";
  suggestions: string[];
  /** Plain-words setup steps shown in Settings. */
  setup: string;
  /** OpenAI's reasoning models only accept the default temperature. */
  temperature?: boolean;
};

export const AI_CATALOG: Record<AiKind, AiInfo> = {
  openai: {
    name: "OpenAI (ChatGPT models)",
    about: "Pay per use from prepaid API credits.",
    keyName: "openaiKey",
    keyUrl: "https://platform.openai.com/api-keys",
    baseUrl: "https://api.openai.com/v1",
    write: "gpt-5-mini",
    score: "gpt-5-nano",
    models: "openai",
    suggestions: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini"],
    setup:
      "Create a key at platform.openai.com/api-keys and add credit under Billing. A ChatGPT Plus subscription does not include API use.",
    temperature: false,
  },
  gemini: {
    name: "Google Gemini",
    about: "Free tier with daily limits; paid tier if you add billing.",
    keyName: "geminiKey",
    keyUrl: "https://aistudio.google.com/apikey",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    write: "gemini-2.5-flash",
    score: "gemini-2.5-flash-lite",
    models: "openai",
    suggestions: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    setup: "Sign in at aistudio.google.com/apikey and press Create API key. No card needed for the free tier.",
  },
  xai: {
    name: "xAI Grok",
    about: "Pay per use from prepaid credits.",
    keyName: "xaiKey",
    keyUrl: "https://console.x.ai",
    baseUrl: "https://api.x.ai/v1",
    write: "grok-4-fast-non-reasoning",
    score: "grok-3-mini",
    models: "openai",
    suggestions: ["grok-4", "grok-4-fast-non-reasoning", "grok-3-mini"],
    setup: "Sign in at console.x.ai, add credits, then API Keys → Create API key.",
  },
  groq: {
    name: "Groq (fast open models)",
    about: "Free tier with per-minute and daily limits.",
    keyName: "groqKey",
    keyUrl: "https://console.groq.com/keys",
    baseUrl: "https://api.groq.com/openai/v1",
    write: "llama-3.3-70b-versatile",
    score: "llama-3.1-8b-instant",
    models: "openai",
    suggestions: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    setup: "Sign in at console.groq.com/keys and press Create API Key. No card needed.",
  },
  "claude-cli": {
    name: "Claude Code on this computer",
    about: "Uses the claude command you are signed in to, and so your Claude plan.",
    write: "opus",
    score: "haiku",
    models: "fixed",
    suggestions: ["opus", "sonnet", "haiku"],
    setup: "Install Claude Code and sign in once with `claude`.",
  },
  anthropic: {
    name: "Anthropic API (Claude)",
    about: "Claude with an API key. Pay per use.",
    keyName: "anthropicKey",
    keyUrl: "https://console.anthropic.com/settings/keys",
    write: "claude-sonnet-5-5",
    score: "claude-haiku-5-5",
    models: "fixed",
    suggestions: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    setup: "Create a key at console.anthropic.com/settings/keys.",
  },
  ollama: {
    name: "Ollama on this computer",
    about: "Free, unlimited and private; quality depends on the model.",
    baseUrl: "http://127.0.0.1:11434",
    write: "",
    score: "",
    models: "ollama",
    suggestions: [],
    setup: "Install from ollama.com, open it, then run `ollama pull qwen3:8b` in Terminal.",
  },
  "gemini-cli": {
    name: "Gemini CLI on this computer",
    about: "For Gemini CLI set up with an API key or Vertex AI.",
    write: "pro",
    score: "flash",
    models: "fixed",
    suggestions: ["pro", "flash", "flash-lite"],
    setup: "`npm install -g @google/gemini-cli`, run `gemini`, choose Use Gemini API Key.",
  },
  custom: {
    name: "Other OpenAI-style server",
    about: "OpenRouter, LM Studio, or any server with /chat/completions.",
    keyName: "aiKey",
    write: "",
    score: "",
    models: "openai",
    suggestions: [],
    setup: "Paste the server's base URL (ending in /v1) and its key if it needs one.",
  },
};

const ON_BY_DEFAULT = new Set<AiKind>(["openai", "gemini", "xai", "groq", "claude-cli"]);

/** The order you asked for: other AIs first, Claude last. Unused ones stay off until set up. */
export const DEFAULT_CHAIN: ChainEntry[] = (
  ["openai", "gemini", "xai", "groq", "claude-cli", "ollama", "anthropic", "gemini-cli", "custom"] as AiKind[]
).map((kind) => ({
  kind,
  enabled: ON_BY_DEFAULT.has(kind),
  write: AI_CATALOG[kind].write,
  score: AI_CATALOG[kind].score,
  ...(kind === "ollama" ? { baseUrl: AI_CATALOG.ollama.baseUrl } : {}),
  ...(kind === "custom" ? { baseUrl: "" } : {}),
}));

const DEFAULT_BY_KIND = new Map(DEFAULT_CHAIN.map((d) => [d.kind, d]));

/** Keeps saved entries in their order, drops unknown ones, and appends any AI added since. */
export function normaliseChain(saved: Partial<ChainEntry>[] | undefined): ChainEntry[] {
  const out: ChainEntry[] = [];
  const used = new Set<AiKind>();
  for (const e of saved ?? []) {
    const base = e?.kind ? DEFAULT_BY_KIND.get(e.kind) : undefined;
    if (!base || used.has(base.kind)) continue;
    used.add(base.kind);
    out.push({ ...base, ...e } as ChainEntry);
  }
  for (const d of DEFAULT_CHAIN) if (!used.has(d.kind)) out.push({ ...d });
  return out;
}

/** Why an entry cannot be used yet, or null when it is ready. */
export function missingSetup(entry: ChainEntry, keys: Partial<Record<AiKeyName, boolean>>): string | null {
  const info = AI_CATALOG[entry.kind];
  if (entry.kind === "custom" && !entry.baseUrl?.trim()) return "Add the server URL";
  if (info.keyName && entry.kind !== "custom" && !keys[info.keyName]) return "Add an API key";
  if (!entry.write.trim() || !entry.score.trim()) return "Pick the models";
  return null;
}
