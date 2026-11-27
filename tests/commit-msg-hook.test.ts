import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const hook = path.resolve(".githooks/commit-msg");
const dir = mkdtempSync(path.join(tmpdir(), "commit-msg-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function run(message: string) {
  const file = path.join(dir, `msg-${n++}`);
  writeFileSync(file, message);
  return spawnSync("bash", [hook, file], { encoding: "utf8" });
}

describe("commit-msg hook", () => {
  it.each([
    ["a Claude co-author", "feat: add x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n"],
    ["a lower-case co-author line", "fix: y\n\nco-authored-by: claude <noreply@anthropic.com>\n"],
    ["another AI tool as co-author", "fix: y\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>\n"],
    ["a Generated with footer", "docs: z\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n"],
  ])("rejects %s", (_name, message) => {
    const r = run(message);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no AI attribution");
  });

  it.each([
    ["a plain message", "feat: cache the stable prompt prefix\n\nBody text.\n"],
    ["a human co-author", "fix: x\n\nCo-Authored-By: Sam Rivera <sam@example.com>\n"],
    ["a message about the Claude CLI provider", "feat(ai): add the Claude and Gemini CLI providers\n"],
    ["AI lines only in git's comments", "feat: x\n# Co-Authored-By: Claude <noreply@anthropic.com>\n"],
    [
      "AI lines only below the scissors line",
      "feat: x\n# ------------------------ >8 ------------------------\n+Co-Authored-By: Claude <noreply@anthropic.com>\n",
    ],
  ])("accepts %s", (_name, message) => {
    expect(run(message).status).toBe(0);
  });
});
