## What and why
<!-- The problem, and what this changes. Link the issue. -->

## How it was verified
<!-- Commands run and results. Paste the scripts/check.sh --full summary. Screenshots/GIF for UI. -->

## OOP / DSA
<!-- Lint already checks size, complexity, nesting, await-in-loop and find-in-loop. Answer what it cannot. -->
- Hot paths touched and their complexity (e.g. "dedupe: O(n) with a Set of keys"):
- New classes or modules, and why each owns its state:
- Any new `eslint-disable` and the reason for it:

## Checklist
- [ ] Tests added/updated (a failing-first test for bug fixes)
- [ ] `scripts/check.sh --full` passes; skipped checks listed above
- [ ] Self-reviewed against `docs/standards/REVIEW.md`
- [ ] `/code-review` run against `CODE_QUALITY.md` and `DSA_PERFORMANCE.md`
- [ ] No secrets, personal data or local paths in the diff
- [ ] Security impact considered (`docs/standards/SECURITY_CHECKLIST.md`); `SECURITY.md` updated if a new risk
- [ ] Docs / `.env.example` / `EVALS.md` / ADR updated where relevant
