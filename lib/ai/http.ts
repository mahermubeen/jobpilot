/** An AI server answered with an error status. `retryAfterMs` comes from its Retry-After header. */
export class AiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "AiHttpError";
  }
}

/** The AI server could not be reached, or took too long. */
export class AiUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnreachableError";
  }
}

function retryAfter(res: Response): number | null {
  const v = res.headers.get("retry-after");
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return secs * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** POSTs JSON to a local or hosted model server, with a five-minute limit and readable errors. */
export async function postJson<T>(
  url: string,
  body: unknown,
  opts: { label: string; headers?: Record<string, string>; unreachable: string },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...opts.headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5 * 60_000),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new AiUnreachableError(`${opts.label} took longer than 5 minutes and was stopped.`);
    }
    throw new AiUnreachableError(opts.unreachable);
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text) as { error?: string | { message?: string } } | { error?: unknown }[];
      const first = Array.isArray(j) ? j[0] : j;
      const err = (first as { error?: string | { message?: string } }).error;
      detail = typeof err === "string" ? err : err?.message ?? text;
    } catch {}
    throw new AiHttpError(
      `${opts.label} answered ${res.status}: ${detail.trim().slice(0, 300)}`,
      res.status,
      text.slice(0, 2000),
      retryAfter(res),
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${opts.label} returned something that is not JSON.`);
  }
}

export const trimSlash = (url: string) => url.trim().replace(/\/+$/, "");
