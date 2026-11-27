import { spawn } from "node:child_process";

/**
 * Runs an AI command-line tool once: the prompt goes in on stdin, and stdout
 * comes back when it exits. Stops it after five minutes.
 */
export function runCli(
  command: string,
  args: string[],
  input: string,
  opts: { cwd: string; env?: NodeJS.ProcessEnv; label: string; missing: string },
): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${opts.label} took longer than 5 minutes and was stopped.`));
    }, 5 * 60_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new Error(opts.missing) : e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    child.stdin.end(input);
  });
}
