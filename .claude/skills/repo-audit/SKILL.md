---
name: repo-audit
description: Full quality, security and public-readiness audit of this repository. Use when the user asks to audit the repo, check it is production-ready or safe to make public, or "check everything".
---

# Repo audit

Produce an evidence-based audit. Every item is PASS, FAIL, WARN or NOT CHECKED, with the evidence (command output, file:line). Never mark something PASS that you did not actually check.

1. Run `scripts/check.sh --list`, then `scripts/check.sh --full`. Record the summary block verbatim.
2. Run `scripts/public-ready.sh`. Record FAIL/WARN lines verbatim. For each WARN, open the hit and decide: real problem, or intentional (say why).
3. Read `docs/standards/SECURITY_CHECKLIST.md`. For each section relevant to this codebase, inspect the actual code (route handlers, auth, DB queries, file access, model-output handling, client bundles, Dockerfiles, workflows). Cite file:line for every FAIL/WARN.
4. Read `docs/standards/TESTING.md`: list the main flows and whether each has unit / integration / e2e coverage. Name the biggest untested risk.
5. Skim hot paths against `docs/standards/DSA_PERFORMANCE.md` and the codebase against `docs/standards/CODE_QUALITY.md`; report the top 5 concrete issues only, not style nits.
6. If the project has AI features: check `EVALS.md` exists and is current, and that model output is validated (`docs/standards/AI_FEATURES.md`).
7. Check docs: README (problem, run, architecture, decisions), LICENSE, SECURITY.md, .env.example, AGENTS.md project section filled in.

Write `reports/audit-YYYY-MM-DD.md` (create `reports/`; ensure it is gitignored if the report might contain sensitive findings) with:
- Verdict line: READY / READY WITH WARNINGS / NOT READY, for "public repo" and for "production" separately.
- A table: area | status | evidence | fix.
- Prioritised fix list (blocking first).

Do not fix anything during the audit unless the user asks; then fix blocking items first, one commit-sized step at a time, re-running the gate after each.
