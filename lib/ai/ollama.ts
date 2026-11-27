import { postJson, trimSlash } from "./http";
import { noteTokens } from "./meter";
import type { AiProvider } from "./provider";
import { SYSTEM_PROMPT } from "./system";

export const OLLAMA_URL = "http://127.0.0.1:11434";

/** Uses a model running in Ollama on this machine: free, and nothing leaves the computer. */
export function ollamaProvider(baseUrl: string, models: { write: string; score: string }): AiProvider {
  const base = trimSlash(baseUrl || OLLAMA_URL);
  return {
    name: "Ollama (local)",
    async complete(prompt, { tier }) {
      const model = tier === "score" ? models.score : models.write;
      if (!model) throw new Error("Pick an Ollama model in Settings.");
      const reply = await postJson<{ message?: { content?: string }; prompt_eval_count?: number; eval_count?: number }>(
        `${base}/api/chat`,
        {
          model,
          stream: false,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          // Ollama's default context is small; job descriptions and CVs need more.
          options: { num_ctx: 16384, temperature: tier === "score" ? 0.1 : 0.4 },
          // Thinking models would spend their time on hidden reasoning.
          think: false,
        },
        {
          label: "Ollama",
          unreachable: `Ollama is not running at ${base}. Open the Ollama app or run \`ollama serve\`.`,
        },
      );
      noteTokens(model, reply.prompt_eval_count, reply.eval_count);
      const text = reply.message?.content?.trim();
      if (!text) throw new Error(`Ollama model ${model} returned an empty reply.`);
      return text;
    },
  };
}

/** The models pulled into Ollama on this machine, or null when Ollama is not running. */
export async function listOllamaModels(baseUrl = OLLAMA_URL): Promise<string[] | null> {
  try {
    const res = await fetch(`${trimSlash(baseUrl)}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name?: string }[] };
    return (body.models ?? []).map((m) => m.name ?? "").filter(Boolean).sort();
  } catch {
    return null;
  }
}
