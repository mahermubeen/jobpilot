import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/util";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Wraps a route handler so every failure becomes `{ error }` JSON with a status. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response | unknown>) {
  return async (...args: A): Promise<Response> => {
    try {
      const result = await fn(...args);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
      }
      console.error(err);
      return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
    }
  };
}

/** Keeps only the allowed keys of a request body; "" becomes null. */
export function pick<T extends string>(body: unknown, keys: readonly T[]): Partial<Record<T, unknown>> {
  const out: Partial<Record<T, unknown>> = {};
  if (!body || typeof body !== "object") return out;
  for (const k of keys) {
    if (k in body) {
      const v = (body as Record<string, unknown>)[k];
      out[k] = typeof v === "string" && v.trim() === "" ? null : v;
    }
  }
  return out;
}

export type IdParams = { params: Promise<{ id: string }> };

export function pdfResponse(pdf: Buffer, filename: string, inline = false) {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
