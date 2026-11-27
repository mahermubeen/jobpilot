import { spawn } from "node:child_process";
import os from "node:os";
import { noteTokens } from "./meter";
import type { AiProvider } from "./provider";
import { SYSTEM_PROMPT as SYSTEM } from "./system";


/**
 * Uses the Claude Code command that is installed and signed in on this
 * machine. Tools, plugins, MCP servers and project settings are switched off
 * so each call is a plain, small completion.
 */
export function claudeCliProvider(models: { write: string; score: string }): AiProvider {
  return {
    name: "Claude Code (local)",
    complete(prompt, { tier }) {
      const model = tier === "score" ? models.score : models.write;
      const args = [
        "-p",
        "--output-format", "json",
        "--model", model,
        "--tools", "",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--system-prompt", SYSTEM,
      ];
      return new Promise<string>((resolve, reject) => {
        const child = spawn("claude", args, {
          cwd: os.tmpdir(),
          stdio: ["pipe", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Claude Code took longer than 5 minutes and was stopped."));
        }, 5 * 60_000);

        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", (e: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          reject(
            e.code === "ENOENT"
              ? new Error(
                  "The `claude` command was not found. Install Claude Code and sign in, or switch to an Anthropic API key in Settings.",
                )
              : e,
          );
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          try {
            const parsed = JSON.parse(out) as ClaudeCliResult;
            if (parsed.is_error || typeof parsed.result !== "string") {
              throw new Error(parsed.result || "Claude Code returned an error.");
            }
            const usage = claudeCliUsage(parsed);
            noteTokens(usage.model || model, usage.inTokens, usage.outTokens);
            resolve(parsed.result);
          } catch (e) {
            const detail = (err || out).trim().slice(0, 400);
            reject(
              new Error(
                `Claude Code failed (exit ${code}). ${detail || (e as Error).message}`,
              ),
            );
          }
        });
        child.stdin.end(prompt);
      });
    },
  };
}

type ClaudeCliResult = {
  result?: string;
  is_error?: boolean;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
};

/** Tokens from `claude -p --output-format json`. Cached prompt tokens count as input. */
export function claudeCliUsage(parsed: ClaudeCliResult): { model: string | null; inTokens: number; outTokens: number } {
  const u = parsed.usage ?? {};
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    model: Object.keys(parsed.modelUsage ?? {})[0] ?? null,
    inTokens: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens),
    outTokens: n(u.output_tokens),
  };
}
