import { getSecrets, getSettings, getState, setState, type Secrets } from "@/lib/settings";
import { anthropicProvider } from "./anthropic";
import { AI_CATALOG, missingSetup, type AiKeyName, type AiKind, type ChainEntry } from "./catalog";
import { claudeCliProvider } from "./claude-cli";
import { geminiCliProvider } from "./gemini-cli";
import { AiHttpError, AiUnreachableError } from "./http";
import { ollamaProvider } from "./ollama";
import { openAiCompatibleProvider } from "./openai-compatible";
import { inCallSlot, recordCall } from "./meter";
import type { AiProvider, CompleteOpts } from "./provider";

/** Why an AI was set aside, and until when (null: until its key changes or you re-check it). */
export type Parked = { reason: "rate" | "quota" | "auth" | "down"; message: string; until: number | null; at: number };
export type ParkedMap = Partial<Record<AiKind, Parked>>;
export type Usage = {
  day: string;
  calls: Partial<Record<AiKind, number>>;
  tokens?: Partial<Record<AiKind, { in: number; out: number }>>;
  last?: AiKind;
};

const PARKED = "aiParked";
const USAGE = "aiUsage";
const MIN = 60_000;

export const keyStatus = (secrets: Secrets) =>
  Object.fromEntries(
    (["openaiKey", "geminiKey", "xaiKey", "groqKey", "anthropicKey", "aiKey"] as AiKeyName[]).map((k) => [k, !!secrets[k]]),
  ) as Record<AiKeyName, boolean>;

/** Builds the provider for one chain entry. */
export function providerFor(entry: ChainEntry, secrets: Secrets): AiProvider {
  const info = AI_CATALOG[entry.kind];
  const models = { write: entry.write.trim(), score: entry.score.trim() };
  switch (entry.kind) {
    case "claude-cli":
      return claudeCliProvider(models);
    case "gemini-cli":
      return geminiCliProvider(models);
    case "ollama":
      return ollamaProvider(entry.baseUrl || info.baseUrl || "", models);
    case "anthropic":
      return anthropicProvider(secrets.anthropicKey, models);
    case "custom":
      return openAiCompatibleProvider(entry.baseUrl ?? "", secrets.aiKey, models, { name: info.name });
    default:
      return openAiCompatibleProvider(info.baseUrl!, secrets[info.keyName!], models, {
        name: info.name,
        temperature: info.temperature,
      });
  }
}

/** Sorts a failure into: try again shortly, out of credits, bad key, or down. */
export function classify(err: unknown, now = Date.now()): Parked {
  const message = err instanceof Error ? err.message : String(err);
  const text = (message + " " + (err instanceof AiHttpError ? err.body : "")).toLowerCase();
  const quota = /insufficient_quota|quota|billing|credit|exceeded your current|usage limit|limit reached|resource_exhausted|spending/.test(text);
  if (err instanceof AiHttpError) {
    if (err.status === 401 || err.status === 403) return { reason: "auth", message, until: null, at: now };
    if (err.status === 402 || (err.status === 429 && quota)) return { reason: "quota", message, until: now + 6 * 60 * MIN, at: now };
    if (err.status === 429) return { reason: "rate", message, until: now + Math.max(err.retryAfterMs ?? 0, 2 * MIN), at: now };
    if (err.status === 404 || err.status === 400) return { reason: "down", message, until: now + 10 * MIN, at: now };
    return { reason: "down", message, until: now + 2 * MIN, at: now };
  }
  if (quota) return { reason: "quota", message, until: now + 6 * 60 * MIN, at: now };
  if (err instanceof AiUnreachableError) return { reason: "down", message, until: now + 2 * MIN, at: now };
  return { reason: "down", message, until: now + 2 * MIN, at: now };
}

const isParked = (p: Parked | undefined, now: number) => !!p && (p.until === null || p.until > now);
const today = () => new Date().toISOString().slice(0, 10);

export async function getParked(): Promise<ParkedMap> {
  return (await getState<ParkedMap>(PARKED)) ?? {};
}

export async function unpark(kinds: AiKind[]) {
  const parked = await getParked();
  let changed = false;
  for (const k of kinds) {
    if (!parked[k]) continue;
    delete parked[k];
    changed = true;
  }
  if (changed) await setState(PARKED, parked);
}

async function park(kind: AiKind, p: Parked) {
  const parked = await getParked();
  parked[kind] = p;
  await setState(PARKED, parked);
}

export async function getUsage(): Promise<Usage> {
  const u = await getState<Usage>(USAGE);
  return u && u.day === today() ? u : { day: today(), calls: {} };
}

async function countCall(kind: AiKind, inTokens: number, outTokens: number) {
  const u = await getUsage();
  u.calls[kind] = (u.calls[kind] ?? 0) + 1;
  const t = (u.tokens ??= {})[kind] ?? { in: 0, out: 0 };
  u.tokens[kind] = { in: t.in + inTokens, out: t.out + outTokens };
  u.last = kind;
  await setState(USAGE, u);
}

/** The entries that would be tried right now, in order, with why the others are skipped. */
export async function chainStatus() {
  const [{ ai }, secrets, parked] = await Promise.all([getSettings(), getSecrets(), getParked()]);
  const keys = keyStatus(secrets);
  const now = Date.now();
  return ai.chain.map((entry) => {
    const missing = missingSetup(entry, keys);
    const p = parked[entry.kind];
    return {
      kind: entry.kind,
      enabled: entry.enabled,
      missing,
      parked: isParked(p, now) ? p! : null,
      ready: entry.enabled && !missing && !isParked(p, now),
    };
  });
}

/**
 * One provider that walks the chain: the first AI that is on, set up and not
 * parked gets the call. When it runs out of credits, hits a rate limit or
 * fails, it is parked and the next one is tried.
 */
export function chainProvider(): AiProvider {
  let lastName = "AI chain";
  return {
    get name() {
      return lastName;
    },
    async complete(prompt: string, opts: CompleteOpts) {
      const [{ ai }, secrets, parked] = await Promise.all([getSettings(), getSecrets(), getParked()]);
      const keys = keyStatus(secrets);
      const now = Date.now();
      const failures: string[] = [];
      let tried = 0;
      for (const entry of ai.chain) {
        if (!entry.enabled || missingSetup(entry, keys)) continue;
        const name = AI_CATALOG[entry.kind].name;
        if (isParked(parked[entry.kind], now)) {
          failures.push(`${name}: set aside (${parked[entry.kind]!.reason})`);
          continue;
        }
        tried++;
        try {
          const started = Date.now();
          const { result: text, slot } = await inCallSlot(() => providerFor(entry, secrets).complete(prompt, opts));
          lastName = name;
          recordCall({
            ai: name,
            model: slot.model || (opts.tier === "score" ? entry.score : entry.write),
            tier: opts.tier,
            purpose: opts.purpose ?? (opts.tier === "score" ? "quick task" : "writing"),
            inTokens: slot.inTokens,
            outTokens: slot.outTokens,
            ...(slot.cachedTokens ? { cachedTokens: slot.cachedTokens } : {}),
            ms: Date.now() - started,
          });
          await countCall(entry.kind, slot.inTokens, slot.outTokens);
          return text;
        } catch (err) {
          const p = classify(err);
          await park(entry.kind, p);
          failures.push(`${name}: ${p.message.slice(0, 160)}`);
        }
      }
      if (!tried && !failures.length) {
        throw new Error("No AI is set up. Add at least one in Settings → AI.");
      }
      throw new Error(`Every AI in the chain failed or is set aside. ${failures.join(" · ")}`);
    },
  };
}
