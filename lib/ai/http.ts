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

type PostOptions = { label: string; headers?: Record<string, string>; unreachable: string };

const TIMEOUT_MS = 5 * 60_000;

async function send(url: string, body: unknown, opts: PostOptions): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...opts.headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new AiUnreachableError(`${opts.label} took longer than 5 minutes and was stopped.`);
    }
    throw new AiUnreachableError(opts.unreachable);
  }
}

type ErrorBody = { error?: string | { message?: string } };

/** The error message inside a JSON error body ({error}, {error:{message}} or a list of those), else the raw text. */
function errorDetail(text: string): string {
  try {
    const j = JSON.parse(text) as ErrorBody | ErrorBody[];
    const err = (Array.isArray(j) ? j[0] : j)?.error;
    return typeof err === "string" ? err : (err?.message ?? text);
  } catch {
    return text;
  }
}

/** POSTs JSON to a local or hosted model server, with a five-minute limit and readable errors. */
export async function postJson<T>(url: string, body: unknown, opts: PostOptions): Promise<T> {
  const res = await send(url, body, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new AiHttpError(`${opts.label} answered ${res.status}: ${errorDetail(text).trim().slice(0, 300)}`, res.status, text.slice(0, 2000), retryAfter(res));
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${opts.label} returned something that is not JSON.`);
  }
}

export const trimSlash = (url: string) => url.trim().replace(/\/+$/, "");
