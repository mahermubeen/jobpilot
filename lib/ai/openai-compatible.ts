import { postJson, trimSlash } from "./http";
import { noteTokens } from "./meter";
import type { AiProvider } from "./provider";
import { SYSTEM_PROMPT } from "./system";

type ChatReply = {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

const hostLabel = (base: string) => `AI at ${base.replace(/^https?:\/\//, "").split("/")[0] || "custom URL"}`;

function chatBody(model: string, prompt: string, tier: "score" | "write", sendTemperature: boolean) {
  return {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    ...(sendTemperature ? { temperature: tier === "score" ? 0.1 : 0.4 } : {}),
  };
}

/** Meters the call and returns the reply text, refusing an empty one. */
function readReply(reply: ChatReply, model: string): string {
  noteTokens(reply.model || model, reply.usage?.prompt_tokens, reply.usage?.completion_tokens);
  const text = reply.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`Model ${model} returned an empty reply.`);
  return text;
}

/** Any server with an OpenAI-style /chat/completions endpoint: OpenAI, Gemini API, xAI, Groq, OpenRouter, LM Studio. */
export function openAiCompatibleProvider(
  baseUrl: string,
  apiKey: string,
  models: { write: string; score: string },
  opts: { name?: string; temperature?: boolean } = {},
): AiProvider {
  const base = trimSlash(baseUrl);
  // OpenAI's reasoning models (gpt-5 and later) reject any temperature but the default.
  const sendTemperature = opts.temperature ?? true;
  const request = {
    label: opts.name ?? "The AI server",
    headers: (apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) as Record<string, string>,
    unreachable: `Could not reach ${base}. Check the URL in Settings.`,
  };
  return {
    name: opts.name ?? hostLabel(base),
    async complete(prompt, { tier }) {
      if (!base) throw new Error("Add the AI server URL in Settings.");
      const model = tier === "score" ? models.score : models.write;
      if (!model) throw new Error("Add a model name in Settings.");
      const reply = await postJson<ChatReply>(`${base}/chat/completions`, chatBody(model, prompt, tier, sendTemperature), request);
      return readReply(reply, model);
    },
  };
}

/** The model ids a server offers, from its /models endpoint. */
export async function listOpenAiModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${trimSlash(baseUrl)}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Listing models failed (${res.status}).`);
  const body = (await res.json()) as { data?: { id?: string }[] };
  // Gemini prefixes its ids with "models/"; the chat endpoint wants them without.
  return (body.data ?? [])
    .map((m) => (m.id ?? "").replace(/^models\//, ""))
    .filter(Boolean)
    .sort();
}
