# Security checklist

Based on OWASP Top 10 (web), OWASP API Security Top 10, OWASP Top 10 for LLM Applications and OWASP MASVS (mobile). Go through the sections the change touches. Record new risks and how they're handled in the project's `SECURITY.md`.

## 1. Secrets
- [ ] No secret in code, config, tests, docs, commit history, logs, error messages, client bundles or mobile apps.
- [ ] Secrets come from environment / a secret manager; `.env*` gitignored; `.env.example` lists names with fake values.
- [ ] Anything shipped to a browser or mobile app is public: only publishable keys there (`NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`, `VITE_*` must never hold a secret).
- [ ] A leaked key is **rotated first**, then removed from history. Deleting the commit is not enough.
- [ ] gitleaks runs in pre-commit and CI; GitHub secret scanning + push protection enabled.

## 2. Authentication and sessions
- [ ] Passwords hashed with argon2id / bcrypt / scrypt (never plain, never MD5/SHA-x). Or use a proven provider (OAuth/OIDC, Auth.js, Clerk, Supabase Auth, Cognito).
- [ ] Login, signup, reset and OTP are rate-limited and don't reveal whether an account exists.
- [ ] Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax` or `Strict`; rotated on login; invalidated on logout and password change.
- [ ] JWTs: short expiry, algorithm pinned (no `none`), signature verified, audience/issuer checked, refresh tokens revocable.
- [ ] OAuth/SSO: `state` and PKCE used; redirect URIs exactly allow-listed.
- [ ] MFA available for admin accounts.

## 3. Authorisation (the #1 API bug)
- [ ] Every endpoint checks **who** is calling and **whether they may touch this specific object** (object-level checks, not just "is logged in").
- [ ] IDs from the client are never trusted as proof of ownership; queries are scoped (`WHERE owner_id = :currentUser`).
- [ ] Function-level: admin routes check roles server-side; hiding a button is not access control.
- [ ] Property-level: clients can't set fields like `role`, `isAdmin`, `price`, `ownerId` (mass assignment); responses don't over-expose fields.
- [ ] Deny by default.

## 4. Input handling and injection
- [ ] All input validated at the boundary with a schema (zod, pydantic, etc.): type, length, range, format, allow-list for enums.
- [ ] SQL: parameterised queries / ORM bindings only; never string concatenation. Same for NoSQL (`$where`, operator injection via objects).
- [ ] No shell commands built from input; if unavoidable, argument arrays (no shell) plus allow-list.
- [ ] Paths: no user input in file paths without normalising and checking it stays inside the allowed directory (path traversal).
- [ ] XSS: output encoded by the framework; no raw HTML from users without a sanitiser (DOMPurify); CSP set.
- [ ] SSRF: server-side fetches of user-supplied URLs allow-list hosts/schemes and block private/link-local/metadata IPs (169.254.169.254) after DNS resolution.
- [ ] Deserialisation: no `pickle`, `yaml.load`, `eval`, `Function()`, Java native deserialisation of untrusted data.
- [ ] Regexes on user input checked for catastrophic backtracking.

## 5. Web and API configuration
- [ ] HTTPS everywhere; HSTS.
- [ ] Security headers: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors`/`X-Frame-Options`, `Permissions-Policy`.
- [ ] CORS: explicit origin allow-list; never `*` together with credentials.
- [ ] CSRF protection for cookie-authenticated state-changing requests (SameSite + token or Origin check).
- [ ] Rate limits and request size limits on all public endpoints; pagination caps.
- [ ] Errors return generic messages; no stack traces, SQL or internal paths to clients. Debug mode off in production.
- [ ] File uploads: size limit, type checked by content (magic bytes) not extension, stored outside web root / in object storage with random names, served with `Content-Disposition`, scanned if shared with others.
- [ ] Webhooks verify signatures and timestamps (Stripe, GitHub, etc.).

## 6. Data protection and privacy
- [ ] Collect only what you need; know where personal data lives and who can read it.
- [ ] Sensitive data encrypted at rest where the platform allows; TLS in transit (including DB connections).
- [ ] Logs never contain passwords, tokens, full card numbers, or unnecessary personal data. Redact at the logger.
- [ ] Payments: card data never touches your servers (Stripe Elements/Checkout); amounts computed server-side.
- [ ] Data deletion/export path exists if you have users (GDPR).
- [ ] Backups exist, are encrypted, and restoring has been tested.

## 7. Dependencies and supply chain
- [ ] Lockfile committed; CI uses `npm ci` / `pip install -r` with pinned versions / `go mod verify`.
- [ ] Dependency audit in CI (`npm audit`, `pip-audit`, `govulncheck`, `cargo audit`, `composer audit`, `bundle-audit`); Dependabot or Renovate on.
- [ ] New packages: maintained, reasonable download count, expected name (typosquatting), licence compatible.
- [ ] GitHub Actions pinned to a version (ideally a commit SHA for third-party actions); workflow `permissions:` minimal; no `pull_request_target` running untrusted code.
- [ ] Docker: minimal base image, pinned tag, non-root `USER`, no secrets in layers or build args, image scanned (trivy).

## 8. AI / LLM features (OWASP LLM Top 10)
- [ ] **Prompt injection:** treat all retrieved/user/web content as untrusted data. Delimit it clearly. The model must not be able to perform harmful actions just because some text told it to.
- [ ] **Least-privilege tools:** an agent's tools can only do what this feature needs; destructive or outward actions (send, pay, delete, post) need human confirmation.
- [ ] **Output handling:** model output is validated (schema-parse JSON, allow-list values) before it's used in SQL, HTML, shell, file paths, URLs or business logic.
- [ ] **Data leakage:** no secrets or other users' data in prompts; system prompts assumed to be extractable.
- [ ] **Cost/DoS:** per-user rate limits, max tokens, timeouts, spend alerts.
- [ ] **MCP servers / tool integrations:** scoped credentials, read-only by default, explicit allow-list of operations, audit log.
- [ ] Evals include adversarial cases (see `AI_FEATURES.md`).

## 9. Mobile (React Native / Flutter / native)
- [ ] Tokens in Keychain/Keystore (`expo-secure-store`), never AsyncStorage/SharedPreferences in plain text.
- [ ] No secrets in the app bundle: anything in the binary can be extracted. Proxy third-party calls through your backend.
- [ ] Deep links and intents validated; no sensitive actions triggered by a link alone.
- [ ] Certificate pinning for high-risk apps (finance, health); ATS / cleartext traffic disabled.
- [ ] In-app purchases and wallet/coin balances verified server-side (receipt validation), never trusted from the client.
- [ ] Sensitive screens hidden from app-switcher snapshots; logs stripped in release builds.

## 10. Logging, monitoring, incident readiness
- [ ] Security-relevant events logged (login, failed login, permission denied, admin action, payment) with user ID and request ID.
- [ ] Alerts on spikes in errors, 401/403s, rate-limit hits and spend.
- [ ] `SECURITY.md` tells people how to report a vulnerability privately.

## Automated tools to run
| What | Tool |
|---|---|
| Secrets | gitleaks (pre-commit + CI), GitHub secret scanning + push protection |
| SAST | CodeQL (free on public repos), Semgrep, bandit (Python), gosec (Go), brakeman (Rails) |
| Dependencies | Dependabot, `npm audit`, pip-audit, govulncheck, cargo audit, OSV-Scanner |
| Containers / IaC | trivy, hadolint, tflint / checkov |
| DAST (running app) | OWASP ZAP baseline scan against a staging URL |
| Headers | securityheaders.com, Mozilla Observatory |
