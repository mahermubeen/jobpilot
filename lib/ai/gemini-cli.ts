import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { noteTokens } from "./meter";
import type { AiProvider } from "./provider";
import { runCli } from "./run-cli";
import { SYSTEM_PROMPT } from "./system";

/**
 * An empty working folder holding JobPilot's system prompt. Gemini CLI reads
 * the prompt from GEMINI_SYSTEM_MD in place of its coding-agent prompt, and
 * the empty folder leaves it no project files to look at.
 */
function workdir() {
  const dir = path.join(os.tmpdir(), "jobpilot-gemini");
  mkdirSync(dir, { recursive: true });
  const system = path.join(dir, "system.md");
  writeFileSync(system, SYSTEM_PROMPT + "\n");
  return { dir, system };
}

/**
 * Uses the Gemini CLI installed on this machine, set up with a Gemini API key
 * or Vertex AI. (Google stopped accepting personal Google-account sign-in for
 * Gemini CLI in late 2026, so a consumer Gemini plan cannot be used here.)
 */
export function geminiCliProvider(models: { write: string; score: string }): AiProvider {
  return {
    name: "Gemini CLI (local)",
    async complete(prompt, { tier }) {
      const model = tier === "score" ? models.score : models.write;
      const { dir, system } = workdir();
      const { code, out, err } = await runCli(
        "gemini",
        ["--output-format", "json", ...(model ? ["--model", model] : [])],
        prompt,
        {
          cwd: dir,
          env: { ...process.env, GEMINI_SYSTEM_MD: system },
          label: "Gemini CLI",
          missing:
            "The `gemini` command was not found. Install it with `npm install -g @google/gemini-cli`, run `gemini` once to sign in with Google, or pick another AI in Settings.",
        },
      );
      const parsed = parseGeminiOutput(out);
      if (parsed.response) {
        noteTokens(parsed.model || model || "default", parsed.inTokens, parsed.outTokens);
        return parsed.response;
      }
      const detail = (parsed.error || err || out).trim().slice(0, 400);
      throw new Error(`Gemini CLI failed (exit ${code}). ${detail || "It returned no answer."}`);
    },
  };
}

/** Reads `{ response, error }` from `gemini --output-format json`, ignoring any log lines around it. */
export function parseGeminiOutput(out: string): {
  response?: string;
  error?: string;
  model?: string;
  inTokens?: number;
  outTokens?: number;
} {
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start === -1 || end <= start) return {};
  try {
    const json = JSON.parse(out.slice(start, end + 1)) as {
      response?: unknown;
      error?: { message?: unknown } | unknown;
      stats?: { models?: Record<string, { tokens?: { prompt?: number; candidates?: number; thoughts?: number } }> };
    };
    const response = typeof json.response === "string" && json.response.trim() ? json.response : undefined;
    const e = json.error as { message?: unknown } | undefined;
    const error = e ? (typeof e.message === "string" ? e.message : JSON.stringify(e)) : undefined;
    const models = Object.entries(json.stats?.models ?? {});
    const n = (v: unknown) => (typeof v === "number" ? v : 0);
    return {
      response,
      error,
      model: models[0]?.[0],
      inTokens: models.reduce((t, [, m]) => t + n(m.tokens?.prompt), 0),
      outTokens: models.reduce((t, [, m]) => t + n(m.tokens?.candidates) + n(m.tokens?.thoughts), 0),
    };
  } catch {
    return {};
  }
}
