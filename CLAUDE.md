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
