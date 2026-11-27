import { chainProvider } from "./chain";
import { extractJson } from "./json";

/** "score" is high-volume classification; "write" is cover letters and CVs. */
export type AiTier = "score" | "write";

export interface AiProvider {
  name: string;
  /** `purpose` labels the call in usage reports ("short answers", "cover letter"). */
  complete(prompt: string, opts: { tier: AiTier; purpose?: string }): Promise<string>;
}

/** The AI chain from Settings: every task goes to the first AI that is set up and has credit. */
export async function getProvider(): Promise<AiProvider> {
  return chainProvider();
}

export async function complete(prompt: string, tier: AiTier, purpose?: string): Promise<string> {
  return (await getProvider()).complete(prompt, { tier, purpose });
}

export async function completeJson<T>(prompt: string, tier: AiTier, purpose?: string): Promise<T> {
  const provider = await getProvider();
  const text = await provider.complete(prompt, { tier, purpose });
  try {
    return extractJson<T>(text);
  } catch {
    // One repair attempt: models occasionally wrap JSON in prose.
    const retry = await provider.complete(
      `${prompt}\n\nYour previous reply could not be parsed. Reply with the JSON only, no other text.`,
      { tier, purpose: purpose ? `${purpose} (retry)` : undefined },
    );
    return extractJson<T>(retry);
  }
}
