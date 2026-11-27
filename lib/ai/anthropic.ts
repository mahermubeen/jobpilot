import Anthropic from "@anthropic-ai/sdk";
import type { BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { noteTokens } from "./meter";
import type { AiProvider } from "./provider";
import { SYSTEM_PROMPT as SYSTEM } from "./system";

/** Models whose safety classifiers can decline a request and that accept the fallback beta. */
const supportsFallbacks = (model: string) =>
  /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);

/** Haiku 4.5 rejects the effort setting; newer models default to thinking on. */
const supportsEffort = (model: string) => !/^claude-haiku-4/.test(model);

/**
 * The user message. When the caller marks a stable start (`cacheUpTo`), that
 * part goes in its own block with a cache breakpoint, so repeated calls (job
 * scoring batches) read it from the prompt cache. Prefixes below the model's
 * minimum length are simply not cached.
 */
export function userContent(prompt: string, cacheUpTo?: number): string | BetaTextBlockParam[] {
  if (!cacheUpTo || !Number.isInteger(cacheUpTo) || cacheUpTo <= 0 || cacheUpTo >= prompt.length) return prompt;
  return [
    { type: "text", text: prompt.slice(0, cacheUpTo), cache_control: { type: "ephemeral" } },
    { type: "text", text: prompt.slice(cacheUpTo) },
  ];
}

function textOf(content: { type: string; text?: string }[]): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
}

type Tier = "score" | "write";
type Message = Awaited<ReturnType<ReturnType<Anthropic["beta"]["messages"]["stream"]>["finalMessage"]>>;

/** Model-specific options: effort where supported, and the server-side fallback beta. */
function modelOptions(model: string, tier: Tier) {
  return {
    ...(supportsEffort(model) ? { output_config: { effort: tier === "score" ? ("low" as const) : ("medium" as const) } } : {}),
    ...(supportsFallbacks(model)
      ? {
          betas: ["server-side-fallback-2026-07-01"],
          // SDK typings lag the "default" mode; the API accepts it with the beta above.
          fallbacks: "default" as unknown as null,
        }
      : {}),
  };
}

function meter(message: Message, model: string) {
  const u = message.usage;
  noteTokens(
    message.model || model,
    (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    u.output_tokens,
    u.cache_read_input_tokens,
  );
}

/** The reply text, or a plain-language error for refusals, empty and cut-off replies. */
function replyText(message: Message): string {
  if (message.stop_reason === "refusal") throw new Error("Claude declined this request. Edit the text and try again.");
  const text = textOf(message.content);
  if (!text) throw new Error("Claude returned an empty reply.");
  if (message.stop_reason === "max_tokens") throw new Error("Claude's reply was cut off. Try a shorter job description.");
  return text;
}

/** SDK errors in plain language. Order matters: APIError is the parent of the others, so it comes last. */
const FRIENDLY_ERRORS: [new (...args: never[]) => Error, (model: string, e: Error) => string][] = [
  [Anthropic.AuthenticationError, () => "The Anthropic API key was rejected. Check it in Settings."],
  [Anthropic.PermissionDeniedError, (model) => `This API key cannot use the model "${model}".`],
  [Anthropic.NotFoundError, (model) => `The model "${model}" was not found. Change it in Settings.`],
  [Anthropic.RateLimitError, () => "Anthropic rate limit reached. Wait a minute and try again."],
  [Anthropic.APIConnectionError, () => "Could not reach the Anthropic API. Check your internet connection."],
  [Anthropic.APIError, (_m, e) => `Anthropic API error ${(e as InstanceType<typeof Anthropic.APIError>).status ?? ""}: ${e.message}`],
];

function friendlyError(error: unknown, model: string): unknown {
  const match = FRIENDLY_ERRORS.find(([type]) => error instanceof type);
  return match ? new Error(match[1](model, error as Error)) : error;
}

/** Uses the Anthropic API with the user's own key. */
export function anthropicProvider(apiKey: string, models: { write: string; score: string }): AiProvider {
  const client = new Anthropic({ apiKey });
  return {
    name: "Anthropic API",
    async complete(prompt, { tier, cacheUpTo }) {
      const model = tier === "score" ? models.score : models.write;
      try {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: 16000,
          system: SYSTEM,
          messages: [{ role: "user", content: userContent(prompt, cacheUpTo) }],
          ...modelOptions(model, tier),
        });
        const message = await stream.finalMessage();
        meter(message, model);
        return replyText(message);
      } catch (error) {
        throw friendlyError(error, model);
      }
    },
  };
}
