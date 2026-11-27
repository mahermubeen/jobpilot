# Testing

Tests are the proof that the code does what the PR says. Write the test with the change, in the same commit.

## What every change needs
| Change | Minimum test |
|---|---|
| New function / logic | Unit tests: happy path + edge cases (empty, null/undefined, zero, negative, max size, unicode, duplicates) + error path |
| Bug fix | A regression test that fails without the fix |
| New API endpoint | Integration test: valid request, invalid input (400/422), unauthenticated (401), wrong user/role (403), not found (404), and the DB side effect |
| New UI component / screen | Component test of behaviour (what the user sees and does), including loading, empty and error states |
| New user flow (signup, checkout, upload) | One end-to-end test of the critical path |
| Security-relevant code | Tests for the attack: injection payloads, other user's ID (IDOR), oversized input, missing token, expired token |
| AI feature | Eval cases in `EVALS.md` (see `AI_FEATURES.md`) plus unit tests for the parsing/validation of model output |
| DB migration | Migrates up on a copy of production-shaped data; down/rollback path documented |

## Rules
- Test behaviour through public interfaces, not private internals. A refactor should not break tests.
- One reason to fail per test; descriptive names (`rejects_expired_token`, `"shows empty state when no jobs"`).
- Arrange–Act–Assert. No logic (loops, ifs) in tests.
- Deterministic: freeze time, seed randomness, no real network (mock at the HTTP boundary: MSW, nock, respx, httptest), no order dependence.
- Each test sets up its own data; use factories/builders, not shared mutable fixtures.
- Fake data only: `@example.com`, `+1 555 01xx`, fictional names. Never production data.
- Don't mock what you own just to hit coverage; prefer real collaborators in-process, mocks at system edges.
- Flaky test = bug. Fix or quarantine with an issue link the same day; never "retry until green".
- Coverage target: ~80% lines on business logic, 100% on money/auth/permission code. Coverage is a floor, not a goal: assertions matter.

## The pyramid
1. **Static** (always): formatter, linter, type checker, secret scan. Cheapest bugs to catch.
2. **Unit** (many, ms each): pure logic, validators, reducers, utils.
3. **Integration** (some): API + real DB (testcontainers / PGlite / SQLite in-memory / docker compose), queues, file storage.
4. **Contract** (APIs with other teams/apps): OpenAPI schema validation, Pact, or snapshot of response shapes.
5. **End-to-end** (few, critical paths only): real browser or device.
6. **Non-functional** (before release): accessibility, performance/load, security scanning, visual regression.

## Tools by stack
| Stack | Unit / integration | Component | E2E | Other |
|---|---|---|---|---|
| TypeScript / Node | Vitest (or Jest), Supertest, MSW, testcontainers | React Testing Library + user-event | Playwright | `@axe-core/playwright` (a11y), Lighthouse CI, k6 |
| React Native / Expo | Jest + jest-expo | React Native Testing Library | Maestro or Detox | `expo-doctor`, Reassure (perf) |
| Python (Flask/FastAPI/Django) | pytest, pytest-asyncio, httpx/TestClient, respx, factory_boy, testcontainers | – | Playwright (python) | Hypothesis (property), pytest-cov, locust |
| Go | `testing`, testify, httptest, testcontainers-go | – | Playwright | `go test -race`, `-bench`, fuzzing (`go test -fuzz`) |
| Rust | `cargo test`, rstest, mockall | – | – | proptest, cargo-fuzz, criterion |
| Java / Kotlin | JUnit 5, Mockito/MockK, Spring Boot Test, testcontainers | – | Playwright / Selenium | JaCoCo, PIT (mutation) |
| PHP | PHPUnit / Pest | – | Laravel Dusk / Playwright | Infection (mutation) |
| Ruby | RSpec / Minitest | – | Capybara | SimpleCov |
| Dart / Flutter | `flutter test` | widget tests | integration_test / Patrol | golden tests |
| .NET | xUnit / NUnit, WebApplicationFactory | bUnit | Playwright | coverlet |

## Frontend checklist
- [ ] Renders loading, empty, error and success states.
- [ ] Forms: validation messages, disabled submit while pending, double-submit prevented, server error shown.
- [ ] Keyboard: every action reachable with Tab/Enter/Space; focus visible and managed in dialogs.
- [ ] Accessibility: axe has no serious/critical violations; inputs labelled; images have alt text.
- [ ] Responsive: key screens at 360px, 768px, 1280px widths; mobile safe areas.
- [ ] No console errors or warnings during tests.
- [ ] XSS: user content rendered as text, never as raw HTML (`dangerouslySetInnerHTML`, `v-html`, `innerHTML`) unless sanitised.

## Backend checklist
- [ ] Input validation: wrong types, missing fields, extra fields, huge payloads, unicode, SQL/NoSQL/command injection strings.
- [ ] AuthN: no token, bad token, expired token, revoked session.
- [ ] AuthZ: user A cannot read/modify user B's resource by changing an ID (IDOR). Role checks on every admin route.
- [ ] Idempotency and concurrency: double submit, two requests racing on the same row, retries of payments/webhooks.
- [ ] Webhooks: signature verified; replayed and out-of-order events handled.
- [ ] External failures: third-party timeout/500/rate-limit (429) handled and surfaced correctly.
- [ ] Response shape and status codes match the API contract; errors don't leak stack traces.
- [ ] Rate limits actually trigger.

## Mobile checklist
- [ ] Offline / flaky network, app backgrounded and resumed, permission denied paths.
- [ ] Small screens, large text (dynamic type), dark mode, RTL if supported.
- [ ] Tokens in secure storage (Keychain / Keystore via expo-secure-store), never AsyncStorage.
- [ ] Deep links validated; no sensitive data in logs or screenshots of sensitive screens.
