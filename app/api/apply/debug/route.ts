import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError, route } from "@/lib/api";
import { assertLocalCaller } from "@/lib/apply/guard";
import { dataDir } from "@/lib/db";

const MAX_BYTES = 3 * 1024 * 1024;

/**
 * Saves a copy of an application form's layout (no typed values, scripts or
 * hidden inputs; the extension strips them) to data/debug/, so a page the
 * extension misreads can be fixed from its real markup. Nothing leaves this computer.
 * Body: `{ url, html }`.
 */
export const POST = route(async (req: Request) => {
  assertLocalCaller(req);
  const { url, html } = (await req.json()) as { url?: string; html?: string };
  if (typeof html !== "string" || !html.trim()) throw new HttpError(400, "No page layout was sent.");
  if (html.length > MAX_BYTES) throw new HttpError(413, "That page is too large to save.");
  let host = "page";
  try {
    host = new URL(url ?? "").hostname.replace(/[^a-z0-9.-]/gi, "") || "page";
  } catch {}
  const dir = path.join(dataDir(), "debug");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${host}-${new Date().toISOString().replace(/[:.]/g, "-")}.html`);
  await writeFile(file, `<!-- ${String(url ?? "").replace(/--/g, "")} -->\n${html}`);
  return { file };
});
