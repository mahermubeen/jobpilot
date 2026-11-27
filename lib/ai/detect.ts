import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listOllamaModels } from "./ollama";

export type DetectedAi = {
  claude: { installed: boolean };
  gemini: { installed: boolean; signedIn: boolean };
  ollama: { running: boolean; models: string[] };
};

const has = (command: string) =>
  new Promise<boolean>((resolve) =>
    execFile("/usr/bin/which", [command], (err, out) => resolve(!err && !!out.trim())),
  );

/** Which AI tools this computer has: the signed-in CLIs and the models pulled into Ollama. */
export async function detectAi(ollamaUrl?: string): Promise<DetectedAi> {
  const [claude, gemini, models] = await Promise.all([
    has("claude"),
    has("gemini"),
    listOllamaModels(ollamaUrl),
  ]);
  const geminiHome = path.join(os.homedir(), ".gemini");
  return {
    claude: { installed: claude },
    gemini: {
      installed: gemini,
      // Google sign-in leaves OAuth credentials here; an API key in the environment also works.
      signedIn:
        existsSync(path.join(geminiHome, "oauth_creds.json")) ||
        !!process.env.GEMINI_API_KEY ||
        !!process.env.GOOGLE_API_KEY,
    },
    ollama: { running: models !== null, models: models ?? [] },
  };
}
