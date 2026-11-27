import { AsyncLocalStorage } from "node:async_hooks";
import type { AiTier } from "./provider";

/** One AI call that answered: which AI, which model, what for, and the tokens it used. */
export type AiCall = {
  ai: string;
  model: string;
  tier: AiTier;
  purpose: string;
  inTokens: number;
  outTokens: number;
  /** Input tokens served from the provider's prompt cache (already counted in `inTokens`). */
  cachedTokens?: number;
  ms: number;
};

export type Slot = { model?: string; inTokens: number; outTokens: number; cachedTokens?: number };

// The calls made while one piece of work runs (one "Fill this page"), and the
// token counts a provider reports for the single call in progress.
const work = new AsyncLocalStorage<AiCall[]>();
const slot = new AsyncLocalStorage<Slot>();

/** Runs `fn` and returns its result with every AI call made inside it. */
export async function metered<T>(fn: () => Promise<T>): Promise<{ result: T; calls: AiCall[] }> {
  const calls: AiCall[] = [];
  const result = await work.run(calls, fn);
  return { result, calls };
}

/** Adds a finished call to the work being metered, if any. */
export function recordCall(call: AiCall) {
  work.getStore()?.push(call);
}

/** Runs one provider call and collects the token counts the provider reports with `noteTokens`. */
export async function inCallSlot<T>(fn: () => Promise<T>): Promise<{ result: T; slot: Slot }> {
  const s: Slot = { inTokens: 0, outTokens: 0 };
  const result = await slot.run(s, fn);
  return { result, slot: s };
}

/** Providers call this with the usage their API returned. `cachedTokens` is part of `inTokens`. */
export function noteTokens(model: string, inTokens: unknown, outTokens: unknown, cachedTokens?: unknown) {
  const s = slot.getStore();
  if (!s) return;
  s.model = model;
  s.inTokens += num(inTokens);
  s.outTokens += num(outTokens);
  const cached = num(cachedTokens);
  if (cached) s.cachedTokens = (s.cachedTokens ?? 0) + cached;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Totals for a list of calls. */
export function sumCalls(calls: AiCall[]) {
  return {
    calls: calls.length,
    inTokens: calls.reduce((n, c) => n + c.inTokens, 0),
    outTokens: calls.reduce((n, c) => n + c.outTokens, 0),
    cachedTokens: calls.reduce((n, c) => n + (c.cachedTokens ?? 0), 0),
  };
}
