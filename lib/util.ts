import { randomUUID } from "node:crypto";

export const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const slug = (s: string, fallback = "item") =>
  norm(s).replace(/ /g, "-").slice(0, 80) || fallback;

export const uid = () => randomUUID().replace(/-/g, "").slice(0, 16);

export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysBetween(fromIso: string, to = new Date()): number {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / 864e5);
}

/** "https://www.Acme.io/careers" -> "acme.io" */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

export function truncate(s: string | null | undefined, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Keeps digits and a leading +, for dial links. */
export function dialable(phone: string | null | undefined): string {
  const t = (phone ?? "").trim();
  const digits = t.replace(/[^\d]/g, "");
  if (!digits) return "";
  return (t.startsWith("+") ? "+" : "") + digits;
}

/**
 * A queue that runs async steps one at a time, in the order they were asked for.
 * A failed step does not stop the ones after it.
 */
export function oneAtATime() {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };
}

/** Text as a regular expression that matches it literally (dots, brackets and plus signs included). */
export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
