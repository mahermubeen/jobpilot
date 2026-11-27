// Fakes for the extension tests: a `chrome` with in-memory storage and recorded
// calls, a local JobPilot app answering fetch, and the extension's source files.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";

export type Listener = (...args: unknown[]) => unknown;
export type Injection = { target: { tabId: number; frameIds?: number[]; allFrames?: boolean }; files?: string[]; func?: (...a: unknown[]) => unknown; args?: unknown[] };
export type Frame = { frameId: number; result: unknown };

const EXT = path.resolve(import.meta.dirname, "../../extension");
export const source = (f: string) => fs.readFileSync(path.join(EXT, f), "utf8");

/** A fake `chrome` with in-memory storage and recorded calls; `frames` answers executeScript. */
export function fakeChrome(opts: { frames?: (inj: Injection) => Frame[]; tab?: Record<string, unknown> } = {}) {
  const session = new Map<string, unknown>();
  const local = new Map<string, unknown>([["port", 3000]]);
  const listeners: Record<string, Listener[]> = { message: [], updated: [], created: [], removed: [], changed: [] };
  const calls = { injections: [] as Injection[], sent: [] as unknown[], created: [] as unknown[] };
  const tab = { id: 7, url: "https://jobs.example/apply/1#top", title: "Apply · Acme Widgets", ...opts.tab };
  const get = (store: Map<string, unknown>) => async (keys: unknown) => {
    if (typeof keys === "string") return store.has(keys) ? { [keys]: store.get(keys) } : {};
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
    return Object.fromEntries(Object.entries(keys as object).map(([k, d]) => [k, store.has(k) ? store.get(k) : d]));
  };
  const set = (store: Map<string, unknown>, area: string) => async (items: Record<string, unknown>) => {
    const changes: Record<string, { newValue: unknown }> = {};
    for (const [k, v] of Object.entries(items)) {
      store.set(k, structuredClone(v));
      changes[k] = { newValue: structuredClone(v) };
    }
    for (const l of listeners.changed) l(changes, area);
  };
  const chrome = {
    storage: {
      local: { get: get(local), set: set(local, "local") },
      session: {
        get: get(session),
        set: set(session, "session"),
        remove: async (keys: string[]) => void keys.forEach((k) => session.delete(k)),
      },
      onChanged: { addListener: (l: Listener) => listeners.changed.push(l) },
    },
    tabs: {
      get: async (id: number) => (id === tab.id ? tab : Promise.reject(new Error("no tab"))),
      query: async () => [tab],
      create: async (t: unknown) => void calls.created.push(t),
      onUpdated: { addListener: (l: Listener) => listeners.updated.push(l) },
      onCreated: { addListener: (l: Listener) => listeners.created.push(l) },
      onRemoved: { addListener: (l: Listener) => listeners.removed.push(l) },
    },
    scripting: {
      executeScript: async (inj: Injection) => {
        calls.injections.push(inj);
        return (opts.frames ?? (() => []))(inj);
      },
    },
    runtime: {
      id: "test-extension",
      getManifest: () => JSON.parse(source("manifest.json")),
      onMessage: { addListener: (l: Listener) => listeners.message.push(l) },
      sendMessage: vi.fn(async (msg: { type: string }): Promise<unknown> => {
        calls.sent.push(msg);
        return null;
      }),
    },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return { chrome, session, local, listeners, calls, tab };
}

export type Route = (url: URL, init?: RequestInit) => unknown;
/** A fake JobPilot app: each route returns a JSON body, or a Response for anything else. */
export function fakeApp(routes: Record<string, Route>) {
  const seen: { path: string; method: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    seen.push({ path: url.pathname + url.search, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[`${init?.method ?? "GET"} ${url.pathname}`];
    if (!route) return new Response(JSON.stringify({ error: `no route ${url.pathname}` }), { status: 404 });
    const out = await route(url, init);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  });
  (globalThis as Record<string, unknown>).fetch = fetchMock;
  return { seen, fetchMock };
}

export type FakeChrome = ReturnType<typeof fakeChrome>;

/** Fake timers and a fixed clock for each test, and an empty page. */
export function installFakeClock() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });
  afterEach(() => vi.useRealTimers());
}
