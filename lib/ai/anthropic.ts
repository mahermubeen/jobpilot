import Anthropic from "@anthropic-ai/sdk";
import { noteTokens } from "./meter";
import type { AiProvider } from "./provider";
import { SYSTEM_PROMPT as SYSTEM } from "./system";


/** Models whose safety classifiers can decline a request and that accept the fallback beta. */
const supportsFallbacks = (model: string) =>
  /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);

/** Haiku 4.5 rejects the effort setting; newer models default to thinking on. */
const supportsEffort = (model: string) => !/^claude-haiku-4/.test(model);

function textOf(content: { type: string; text?: string }[]): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Uses the Anthropic API with the user's own key. */
export function anthropicProvider(
  apiKey: string,
  models: { write: string; score: string },
): AiProvider {
  const client = new Anthropic({ apiKey });

  return {
    name: "Anthropic API",
    async complete(prompt, { tier }) {
      const model = tier === "score" ? models.score : models.write;
      try {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: 16000,
          system: SYSTEM,
          messages: [{ role: "user", content: prompt }],
          ...(supportsEffort(model)
            ? { output_config: { effort: tier === "score" ? "low" : "medium" } }
            : {}),
          ...(supportsFallbacks(model)
            ? {
                betas: ["server-side-fallback-2026-07-01"],
                // SDK typings lag the "default" mode; the API accepts it with the beta above.
                fallbacks: "default" as unknown as null,
              }
            : {}),
        });
        const message = await stream.finalMessage();
        const u = message.usage;
        noteTokens(
          message.model || model,
          (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
          u.output_tokens,
        );

        if (message.stop_reason === "refusal") {
          throw new Error("Claude declined this request. Edit the text and try again.");
        }
        const text = textOf(message.content);
        if (!text) throw new Error("Claude returned an empty reply.");
        if (message.stop_reason === "max_tokens") {
          throw new Error("Claude's reply was cut off. Try a shorter job description.");
        }
        return text;
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError) {
          throw new Error("The Anthropic API key was rejected. Check it in Settings.");
        }
        if (error instanceof Anthropic.PermissionDeniedError) {
          throw new Error(`This API key cannot use the model "${model}".`);
        }
        if (error instanceof Anthropic.NotFoundError) {
          throw new Error(`The model "${model}" was not found. Change it in Settings.`);
        }
        if (error instanceof Anthropic.RateLimitError) {
          throw new Error("Anthropic rate limit reached. Wait a minute and try again.");
        }
        if (error instanceof Anthropic.APIConnectionError) {
          throw new Error("Could not reach the Anthropic API. Check your internet connection.");
        }
        if (error instanceof Anthropic.APIError) {
          throw new Error(`Anthropic API error ${error.status ?? ""}: ${error.message}`);
        }
        throw error;
      }
    },
  };
}
