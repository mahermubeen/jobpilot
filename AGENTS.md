<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Commits and pull requests
- No AI attribution: no `Co-Authored-By:` line naming Claude or any other AI tool, and no "Generated with ..." footer, in commits or PR descriptions. The human who commits is the author. `.githooks/commit-msg` rejects such commits (enable it with `git config core.hooksPath .githooks`).

<!-- BEGIN:ai-repo-kit -->
## Engineering standards (ai-repo-kit)

These rules apply to every AI agent and human working in this repo. Details live in `docs/standards/`. When this section and a project rule above disagree, the project rule wins.

### The loop for every change
1. **Understand first.** Read the code you will touch and the code that calls it. Trace where the data comes from and where it goes. Do not guess at APIs: read the installed version's source or docs.
2. **Plan in small steps.** One concern per step. If a task touches more than ~5 files or one layer, write the steps down before coding.
3. **Test with the change.** New behaviour gets a test; a bug fix gets a test that failed before the fix. See `docs/standards/TESTING.md`.
4. **Run the gate.** `scripts/check.sh` (fast) after every change; `scripts/check.sh --full` before saying a feature is done or opening a PR.
5. **Review your own diff** against `docs/standards/REVIEW.md` as if a stranger wrote it.
6. **Report with evidence:** what changed, the commands you ran and their real results, what you could not verify, and any risk left.

### Definition of done
- `scripts/check.sh --full` passes, or every failure is reported with its cause and is shown to be pre-existing.
- Nothing in the summary is "SKIPPED" without saying so to the user.
- Tests cover the new behaviour and its edge cases (empty, null, max size, invalid input, unauthorised user, concurrent call).
- No new secret, credential, personal data or absolute local path in the diff.
- Docs updated where behaviour changed: README, `SECURITY.md` (new risk), `EVALS.md` (AI behaviour), ADR in `docs/decisions/` (hard-to-reverse choice).
- `/code-review` has been run on the diff and checked against `docs/standards/CODE_QUALITY.md` and `DSA_PERFORMANCE.md`: the right abstraction (a class only where state has invariants, small single-purpose functions, strategy tables over growing `if`/`switch` chains) and the right data structure (Map/Set lookups, no N+1 queries, bounded concurrency). Lint enforces only the measurable part.

### OOP and DSA: what is enforced and where
| Rule | Enforced by |
|---|---|
| Cyclomatic complexity ≤ 10, nesting depth ≤ 3, ≤ 4 parameters, functions ≤ 40 lines, files ≤ 400 lines, callbacks nested ≤ 3 | ESLint errors (`eslint.config.mjs`) |
| No `await` inside a loop (use `Promise.all` or `pool()`); a loop that must stay sequential carries `// eslint-disable-next-line no-await-in-loop -- <why>` | ESLint error |
| No `find()` inside a loop or array callback, no `shift()` queues, no `includes()` on a literal array | ESLint `no-restricted-syntax` errors |
| Tests: no function-length limit, callbacks nested ≤ 5, sequential awaits and canned-reply queues allowed | ESLint override for `tests/**` |
| Choosing abstractions and data structures, SOLID, N+1 queries, hot-path complexity | `/code-review` and `docs/standards/REVIEW.md` (a person or agent has to judge these) |

Lint runs in `scripts/check.sh` (Stop hook and pre-commit), in `.githooks/pre-push` (`scripts/check.sh --full` before every push) and in CI (the same `scripts/check.sh --full`). Enable the hooks once with `git config core.hooksPath .githooks`.

### Never
- Commit or print secrets, `.env` files, tokens, private keys, or real personal data. Use `.env.example` and fictional data (`@example.com`, `+1 555 01xx`).
- Make a check pass by weakening it: no deleting or skipping tests, `eslint-disable`, `@ts-ignore`, `# type: ignore`, `# noqa`, `--no-verify`, lowered coverage or audit levels, or loosened security config, unless the user explicitly approves it. If you must, add a comment saying why.
- Build SQL, shell commands, HTML or file paths by concatenating user input. Use parameters, escaping and allow-lists.
- Trust model output, request bodies, query strings, headers, files, webhooks or third-party API responses without validating them.
- Add a dependency without saying why, checking it is maintained, and checking its licence. Prefer the platform/stdlib.
- Edit generated files (lockfiles by hand, migrations already applied, codegen output, build output).
- Run destructive or outward-facing commands (force-push, history rewrite, `DROP`, deleting data, deploying, sending email/messages, publishing packages) without the user's explicit go-ahead.
- Say something works without having run it.

### Where the rules are
| Topic | File |
|---|---|
| Clean code, OOP/SOLID, error handling, typing | `docs/standards/CODE_QUALITY.md` |
| Data structures, complexity, queries, caching | `docs/standards/DSA_PERFORMANCE.md` |
| What and how to test, per layer and stack | `docs/standards/TESTING.md` |
| Security checklist (OWASP web, API, LLM, mobile) | `docs/standards/SECURITY_CHECKLIST.md` |
| AI/LLM features: evals, cost, prompt injection | `docs/standards/AI_FEATURES.md` |
| Self-review before "done" | `docs/standards/REVIEW.md` |
| Before making a repo public | `docs/standards/PUBLIC_REPO_CHECKLIST.md` |
| Before shipping to production | `docs/standards/PRODUCTION_READINESS.md` |

### Starting a new project from scratch
Set these up in the first commit, before features, so every later change is checked:
1. Language strict mode (TS `strict`, mypy/pyright strict, `-D warnings`), formatter, linter.
2. A test runner with one passing test, and `lint`/`typecheck`/`test`/`build` scripts the gate can find.
3. `.gitignore` (env files, keys, build output), `.env.example`, input validation at every boundary (zod / pydantic / etc.).
4. `README.md` (problem, run, architecture, decisions), `SECURITY.md`, `LICENSE`, and `EVALS.md` if there is any AI feature.
5. CI running `scripts/check.sh --full` plus secret scanning, then build features in small, tested, reviewed steps.

### Commands
```bash
scripts/check.sh            # fast gate: secrets, format, lint, types, unit tests
scripts/check.sh --full     # + build, e2e, dependency audit, SAST, history secret scan
scripts/public-ready.sh     # is this repo safe to make public?
```
Per-project settings for the gate live in `.checkrc`.
<!-- END:ai-repo-kit -->
