# CLAUDE.md

@AGENTS.md

Local-first job search app (Next.js 16, PGlite/Postgres via Drizzle): find jobs, score them against your CV, find contacts, draft emails and tailored CVs, send from Gmail after review, and fill application forms with a browser extension.

## Layout
- `app/`: pages (Today, Jobs, Leads, Outbox, Settings, Setup) and `app/api/*` route handlers
- `components/`: UI (`ui.tsx` primitives, `jobs-board.tsx`, `settings/sections.tsx`, `shell.tsx`)
- `lib/ai/`: provider chain (Anthropic, OpenAI-compatible, Ollama, Claude/Gemini CLI), prompts in `tasks.ts`
- `lib/sources/`: job sources (Apify actors, ATS boards, feeds, JobSpy); `lib/pipeline/`: run, dedupe, filter, score, send
- `lib/apply/`: answer bank and form-answer resolution for the extension; `lib/cv/`: CV types, variant sanitiser, PDF
- `lib/db/`: schema and connection; `drizzle/`: generated migrations
- `extension/`: Chrome MV3 form filler; `scripts/`: import, prune, JobSpy runner; `tests/`: vitest
- `proxy.ts` + `lib/local-request.ts`: origin and host guard for every API route

## Run and test
```bash
npm install
npm run dev                                   # http://127.0.0.1:3000
npm run lint && npm run typecheck && npm test
npm run db:generate                           # after changing lib/db/schema.ts
```

## Never
- Read, print, paste or commit anything from `data/` or `.env`: they hold API keys, the Gmail password, the owner's CV and other people's contact details.
- Put real names, phone numbers, emails or salaries in tests, fixtures or prompt examples. Use fictional people and +1 555 01xx numbers.
- Weaken these guards: `proxy.ts` origin/host checks, `assertLocalCaller` on `/api/apply/*`, the `127.0.0.1` binding in `package.json`, `sanitizeVariant`, send-only-on-click and the guessed-address confirmation.
- Let the scheduler or any background run send email.
- Edit generated files in `drizzle/` by hand.

## Conventions
- Route handlers are wrapped in `route()` (`lib/api.ts`); errors are `{ error }` JSON via `HttpError`.
- Model output is parsed and validated before use; never trust it as-is.
- Small, conventional commits (`feat:`, `fix:`, `security:`, `test:`, `docs:`, `ci:`, `chore:`).

<!-- BEGIN:ai-repo-kit -->
## Claude Code specifics (ai-repo-kit)

- `AGENTS.md` is the rulebook; follow its loop and definition of done.
- A **Stop hook** (`.claude/hooks/verify.sh`) runs `scripts/check.sh --fast` whenever you end a turn with uncommitted changes. If it blocks you, fix the cause. Do not edit or disable the hook, `.claude/settings.json`, `scripts/check.sh` or `.checkrc` to get past it. If a failure is pre-existing and unrelated, tell the user plainly.
- Before saying a feature is done, run `scripts/check.sh --full` and paste the summary block into your reply.
- `/repo-audit` runs the full audit (gate + public-readiness + checklists) and writes `reports/audit-<date>.md`.
- For a larger change, also run `/code-review` on the diff, and `/security-review` when it touches auth, input handling, file access, payments, secrets or AI tool use.
- Keep personal, machine-only notes in `CLAUDE.local.md` (gitignored), never in this file.
<!-- END:ai-repo-kit -->
