# Evals

How we know JobPilot's AI features work, how they fail, and what they cost. Method: [`docs/standards/AI_FEATURES.md`](docs/standards/AI_FEATURES.md).

## Features under test

| Feature | Code | What code enforces after the model replies |
|---|---|---|
| Job scoring (fit, score, flags, reason) | `scoreJobs` in `lib/ai/tasks.ts` | JSON parsed; unknown ids dropped; score clamped to 0-100; `fit` limited to Strong/Partial/Skip (falls back to the score); max 3 flags; reason truncated |
| Cover letter / outreach email | `draftApplication`, `letterProblem` in `lib/ai/tasks.ts` | Letter must contain "The problem:", "My approach:", "About me:" and be ≥ 400 chars; one retry, then it gives up |
| Tailored CV | `sanitizeVariant` in `lib/cv/variant.ts` | Only bullets, skills and projects that exist in the master CV survive; reworded bullets fall back to the master text |
| CV parsing | `parseCv` in `lib/ai/tasks.ts` | JSON parsed into the `Profile` shape |
| Form answers for the extension | `answerFormFields` in `lib/ai/tasks.ts`, `lib/apply/` | Answers resolved against the answer bank first; model output parsed per field |
| Salary estimate, title expansion | `estimateMarketSalary`, `expandTitles` in `lib/ai/tasks.ts` | Parsed and validated before use |

Untrusted text (job descriptions, company pages) is wrapped in tagged blocks, and the model has no tools: it can't send mail or change settings. See `SECURITY.md`.

Token use per call is metered (`lib/ai/meter.ts`) for every provider in the chain (Anthropic, OpenAI-compatible, Ollama, Claude CLI, Gemini CLI).

## Guard tests that run in CI today

These check the code around the model, using stubbed replies. They don't measure model quality.

| Test file | Covers |
|---|---|
| `tests/cv.test.ts` | `sanitizeVariant` drops invented content; `extractJson` reads plain, fenced and wrapped JSON and throws on none |
| `tests/cover-letter.test.ts` | Letter shape check, retry-then-give-up, research cleaning and caching |
| `tests/ai-providers.test.ts` | Provider parsing, error surfacing, token counting |
| `tests/prompt-cache.test.ts` | Anthropic cache breakpoint on the stable prompt start, cache-read metering, the same cached start across scoring batches and on the JSON repair retry |
| `tests/answer-bank.test.ts`, `tests/apply.test.ts` | Form-answer resolution |
| `tests/filter.test.ts`, `tests/dedupe.test.ts` | Rule-based filtering before any model call |

## Model-quality eval sets (to build)

Inputs must be fictional (fake companies and people, `@example.com`, `+1 555 01xx`).

| Set | Cases | Pass rule |
|---|---|---|
| Scoring: known answers | 20 jobs with a hand-labelled fit for a fictional profile | Same fit label; score within ±15 |
| Scoring: hard rules | 10 jobs that break a hard rule (location-locked remote, pay below minimum, unpaid) | All marked Skip, with a flag naming the reason |
| Cover letter | 10 jobs with research | Passes `letterProblem`; names a problem that appears in the research; invents no employer, metric or skill missing from the CV |
| Tailored CV | 10 jobs | `sanitizeVariant` drops nothing (nothing was invented) and the chosen bullets match the role |
| Prompt injection | 5 job descriptions containing "ignore previous instructions…" or fake system text | Output still follows the schema; instruction ignored; no hidden text copied into letters |
| Form answers | 15 real-shaped form questions | Correct from the answer bank; says "unknown" rather than inventing facts |

Runner: not written yet. Planned as `scripts/evals.ts` reading fixtures from `tests/evals/` and writing the table below.

## Results

| Date | Provider / model | Scoring known | Hard rules | Letter | CV | Injection | Form | Avg latency | Avg tokens / call |
|---|---|---|---|---|---|---|---|---|---|
| not yet run | | | | | | | | | |

## Known failure modes
- Scoring sees descriptions truncated to 1,800 characters, so requirements near the end of a long post can be missed.
- When a model returns fewer scores than jobs, the missing jobs are dropped, not retried.
- The scoring prompt puts the instructions and the candidate before the jobs so Anthropic can cache them (2026-11-27). The fit, score and flag rules are unchanged, but the order moved. Spot-check scores on the demo seed before trusting a new model with it. A candidate profile shorter than the model's minimum cacheable length (512 tokens on current models) is not cached, so it saves nothing but does no harm.
