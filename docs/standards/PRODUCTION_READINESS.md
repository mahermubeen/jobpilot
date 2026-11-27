# Before shipping to production

## Build and release
- [ ] `scripts/check.sh --full` green in CI on the exact commit being deployed.
- [ ] Reproducible build from the lockfile; versioned artefact or image tag (no `latest` in production).
- [ ] Database migrations are backward compatible with the currently running version (expand → migrate → contract), tested on production-shaped data, with a rollback plan.
- [ ] One-command rollback to the previous release, tested.
- [ ] Feature flags for risky changes; staged/canary rollout for big ones.
- [ ] Mobile: OTA update policy (EAS Update) and minimum supported app version / forced-upgrade path for breaking API changes.

## Configuration
- [ ] All config from environment/secret manager, validated at startup (app refuses to boot with missing/invalid config).
- [ ] Debug modes, verbose errors, source maps exposure and test routes disabled.
- [ ] Separate credentials per environment; least-privilege DB and cloud roles.

## Observability
- [ ] Structured logs (JSON) with request ID / user ID, no secrets or personal data.
- [ ] Error tracking (Sentry or similar) on frontend, backend and mobile, with release tags and source maps uploaded privately.
- [ ] Metrics: request rate, error rate, latency p95/p99, queue depth, DB connections, AI token spend.
- [ ] Health endpoints: liveness and readiness (readiness checks DB/dependencies).
- [ ] Alerts route to a human, with a short runbook for each.
- [ ] Uptime monitor on the public URL.

## Resilience
- [ ] Timeouts, retries with backoff, and circuit breakers on external calls.
- [ ] Rate limiting and request size limits at the edge (Nginx/CDN/API gateway) and in the app.
- [ ] Graceful shutdown (drain connections, finish jobs); background jobs are idempotent and retry safely.
- [ ] Load-tested at expected peak × 2; known bottleneck written down.
- [ ] Backups automated, encrypted, retention set, **restore tested**.

## Security (see `SECURITY_CHECKLIST.md`)
- [ ] HTTPS + HSTS, security headers, CORS allow-list, CSRF protection.
- [ ] Dependency and container scans clean or accepted with a written reason.
- [ ] Admin access behind MFA; production data access audited.
- [ ] Docker runs as non-root with a read-only filesystem where possible; only needed ports exposed.

## Product
- [ ] Privacy policy / terms if collecting user data; cookie consent where required.
- [ ] Accessibility pass on key flows.
- [ ] Analytics events for the flows you need to measure.
- [ ] Support/contact path and status page or incident comms plan.
