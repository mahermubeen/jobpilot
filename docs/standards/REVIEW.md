# Self-review before "done"

This is the answer to "how did you check the code the AI wrote?" Read the full diff (`git diff`, plus new files) top to bottom as a reviewer, not as the author.

## 1. Does it do the right thing?
- [ ] It solves the stated problem, and nothing else (no unrelated refactors, renames or formatting churn).
- [ ] Edge cases handled: empty, null, zero, max, duplicates, unicode, time zones, concurrent calls, partial failure.
- [ ] For each changed function: where does its input come from, where does its output go? Every caller still works.
- [ ] No placeholder, stub, `TODO: implement`, hard-coded test value or fake data left in real code paths.
- [ ] Every API/library call exists in the **installed** version with that signature (no hallucinated methods or options).

## 2. Is it safe? (see `SECURITY_CHECKLIST.md`)
- [ ] New inputs validated; new queries parameterised; new endpoints check authN **and** object-level authZ.
- [ ] No secrets, personal data, absolute local paths or internal URLs added.
- [ ] Model output, user content and third-party responses are validated before use.
- [ ] New dependency? Justified, maintained, licence OK, audit clean.

## 3. Is it good code? (see `CODE_QUALITY.md`, `DSA_PERFORMANCE.md`)
- [ ] Names reveal intent; functions do one thing; no duplicated logic that already exists elsewhere in the repo (search first).
- [ ] Errors handled, not swallowed; external calls have timeouts.
- [ ] No O(n²) on unbounded data, no N+1 queries, no unbounded memory.
- [ ] No dead code, debug logs, commented-out code, unused imports.

## 4. Is it proven?
- [ ] Tests added/updated for the change, including a failing-first test for bug fixes.
- [ ] `scripts/check.sh --full` run; summary pasted. Skipped checks named.
- [ ] For UI: actually rendered and clicked through (or an e2e test did), including error and empty states.
- [ ] For AI: evals re-run and `EVALS.md` updated.

## 5. Is it explained?
- [ ] Docs, `.env.example`, `SECURITY.md`, ADRs updated where behaviour, config, risk or architecture changed.
- [ ] Commit message says what and why.

## Report format (end of every task)
```
Changed:   <files / behaviour, 1-5 bullets>
Verified:  <commands run + actual result, e.g. "check.sh --full: 14 passed, 0 failed, 1 skipped (hadolint not installed)">
Not verified: <anything you couldn't run or check>
Risks / follow-ups: <honest list, or "none">
```
