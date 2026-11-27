"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** JSON request to the app's own API. Throws ApiError with the server's message. */
export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(String(data.error ?? `Request failed (${res.status})`), res.status, data);
  }
  return data as T;
}

/** Loads a GET endpoint, with reload() and optional polling. */
export function useLoad<T>(path: string, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(
    () =>
      api<T>(path).then(
        (next) => {
          if (!alive.current) return;
          setData(next);
          setError(null);
        },
        (e: unknown) => {
          if (alive.current) setError(e instanceof Error ? e.message : "Could not load.");
        },
      ),
    [path],
  );

  useEffect(() => {
    alive.current = true;
    const first = setTimeout(reload, 0);
    const timer = pollMs ? setInterval(reload, pollMs) : null;
    return () => {
      alive.current = false;
      clearTimeout(first);
      if (timer) clearInterval(timer);
    };
  }, [reload, pollMs]);

  return { data, error, reload, loading: data === null && error === null };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const fmtDate = (iso: string | Date | null | undefined) => {
  if (!iso) return "";
  const d = typeof iso === "string" && iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** Local time and a sensible calling window for a contact's time zone. */
export function timeInfo(tz: string | null | undefined) {
  if (!tz) return null;
  try {
    const now = new Date();
    const local = new Intl.DateTimeFormat(undefined, {
      timeZone: tz, hour: "numeric", minute: "2-digit", weekday: "short",
    }).format(now);
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now),
    );
    const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
    return { local, good: hour >= 10 && hour < 17 && !["Sat", "Sun"].includes(day) };
  } catch {
    return null;
  }
}

/**
 * A job's listing link marked with its JobPilot id, so the browser extension
 * knows which job a tab opened from JobPilot is for (it removes the mark).
 * Links that already use # for routing are left alone.
 */
export const jobLink = (link: string, jobId: string) =>
  link.includes("#") ? link : `${link}#jobpilot-job=${encodeURIComponent(jobId)}`;
