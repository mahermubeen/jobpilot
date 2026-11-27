import { route, HttpError } from "@/lib/api";
import { AI_CATALOG, type AiKind } from "@/lib/ai/catalog";
import { listOllamaModels } from "@/lib/ai/ollama";
import { listOpenAiModels } from "@/lib/ai/openai-compatible";
import { getSecrets, getSettings } from "@/lib/settings";

/** The models one AI offers, using its saved key. Fills the model dropdowns in Settings. */
export const GET = route(async (req: Request) => {
  const kind = new URL(req.url).searchParams.get("kind") as AiKind;
  const info = AI_CATALOG[kind];
  if (!info) throw new HttpError(400, "Unknown AI.");
  const [{ ai }, secrets] = await Promise.all([getSettings(), getSecrets()]);
  const entry = ai.chain.find((e) => e.kind === kind);
  if (info.models === "fixed") return { models: info.suggestions };
  if (info.models === "ollama") return { models: (await listOllamaModels(entry?.baseUrl)) ?? [] };
  const base = kind === "custom" ? entry?.baseUrl : info.baseUrl;
  const key = info.keyName ? secrets[info.keyName] : "";
  if (!base || (info.keyName && kind !== "custom" && !key)) return { models: info.suggestions };
  try {
    const models = await listOpenAiModels(base, key);
    return { models: models.length ? models : info.suggestions };
  } catch {
    return { models: info.suggestions };
  }
});
