import { getSecrets, getSettings } from "@/lib/settings";
import { anthropicProvider } from "./anthropic";
import { claudeCliProvider } from "./claude-cli";
import { extractJson } from "./json";

/** "score" is high-volume classification; "write" is cover letters and CVs. */
export type AiTier = "score" | "write";

export interface AiProvider {
  name: string;
  complete(prompt: string, opts: { tier: AiTier }): Promise<string>;
}

/** Add another provider here (for example OpenAI) by implementing AiProvider. */
export async function getProvider(): Promise<AiProvider> {
  const [settings, secrets] = await Promise.all([getSettings(), getSecrets()]);
  if (settings.ai.mode === "anthropic") {
    if (!secrets.anthropicKey) {
      throw new Error("No Anthropic API key saved. Add one in Settings.");
    }
    return anthropicProvider(secrets.anthropicKey, settings.ai.apiModels);
  }
  return claudeCliProvider(settings.ai.cliModels);
}

export async function complete(prompt: string, tier: AiTier): Promise<string> {
  return (await getProvider()).complete(prompt, { tier });
}

export async function completeJson<T>(prompt: string, tier: AiTier): Promise<T> {
  const provider = await getProvider();
  const text = await provider.complete(prompt, { tier });
  try {
    return extractJson<T>(text);
  } catch {
    // One repair attempt: models occasionally wrap JSON in prose.
    const retry = await provider.complete(
      `${prompt}\n\nYour previous reply could not be parsed. Reply with the JSON only, no other text.`,
      { tier },
    );
    return extractJson<T>(retry);
  }
}
