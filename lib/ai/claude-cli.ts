import { spawn } from "node:child_process";
import os from "node:os";
import type { AiProvider } from "./provider";

const SYSTEM =
  "You are a writing and data-extraction engine inside a job application app. " +
  "Follow the instructions in the user message exactly and return only what it asks for.";

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
            const parsed = JSON.parse(out) as { result?: string; is_error?: boolean };
            if (parsed.is_error || typeof parsed.result !== "string") {
              throw new Error(parsed.result || "Claude Code returned an error.");
            }
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
