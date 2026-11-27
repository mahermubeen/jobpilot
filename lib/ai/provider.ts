import { chainProvider } from "./chain";
import { extractJson } from "./json";

/** "score" is high-volume classification; "write" is cover letters and CVs. */
export type AiTier = "score" | "write";

export type CompleteOpts = {
  tier: AiTier;
  /** Labels the call in usage reports ("short answers", "cover letter"). */
  purpose?: string;
  /**
   * The first `cacheUpTo` characters of the prompt are the same across calls
   * (instructions, the candidate). Providers that support prompt caching cache
   * that part; the others ignore it and send the prompt as is.
   */
  cacheUpTo?: number;
};

export interface AiProvider {
  name: string;
  complete(prompt: string, opts: CompleteOpts): Promise<string>;
}

/** The AI chain from Settings: every task goes to the first AI that is set up and has credit. */
export async function getProvider(): Promise<AiProvider> {
  return chainProvider();
}

export async function complete(prompt: string, tier: AiTier, purpose?: string, cacheUpTo?: number): Promise<string> {
  return (await getProvider()).complete(prompt, { tier, purpose, cacheUpTo });
}

export async function completeJson<T>(prompt: string, tier: AiTier, purpose?: string, cacheUpTo?: number): Promise<T> {
  const provider = await getProvider();
  const text = await provider.complete(prompt, { tier, purpose, cacheUpTo });
  try {
    return extractJson<T>(text);
  } catch {
    // One repair attempt: models occasionally wrap JSON in prose.
    const retry = await provider.complete(
      `${prompt}\n\nYour previous reply could not be parsed. Reply with the JSON only, no other text.`,
      // The repair note goes at the end, so the cached start is unchanged.
      { tier, purpose: purpose ? `${purpose} (retry)` : undefined, cacheUpTo },
    );
    return extractJson<T>(retry);
  }
}
