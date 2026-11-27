# Code quality

The test for every rule here: could a new teammate read this code, change it safely, and know where a bug would be?

## Structure
- **One reason to change per unit** (Single Responsibility). A function does one thing at one level of abstraction. A module owns one concept. If you describe it with "and", split it.
- **Layers stay apart:** transport (HTTP handler, CLI, UI event) → application logic → data access. Handlers parse and validate input, call logic, shape the response. Business rules never live in components, controllers or SQL strings scattered around.
- **Dependencies point inwards.** Core logic does not import the framework, the ORM or the HTTP client directly; pass them in (dependency injection) so the logic can be tested without them.
- **Pure where possible.** Push side effects (I/O, time, randomness, globals) to the edges. A pure function is trivially testable.
- **Size guides** (smells, not laws): functions > 40 lines, > 4 parameters, > 3 levels of nesting, files > 400 lines, cyclomatic complexity > 10. Use early returns instead of nested `if`s.

## OOP and SOLID, applied with judgement
- **S**ingle responsibility: see above.
- **O**pen/closed: add behaviour by adding a new implementation (strategy, handler map) rather than growing a `switch` in five places.
- **L**iskov: a subclass/implementation must honour the parent's contract; no throwing "not supported" from an inherited method.
- **I**nterface segregation: small interfaces/types describing what the caller needs, not what the class has.
- **D**ependency inversion: depend on an interface (`Storage`, `Mailer`, `LLMClient`), inject the concrete one.
- **Composition over inheritance.** Inheritance deeper than 2 levels is a smell. Prefer plain functions and data in TS/JS/Python/Go unless an object genuinely owns state plus invariants.
- **Encapsulate invariants:** if a value must always be valid (an email, a money amount, a date range), make a type/constructor that guarantees it, so invalid state cannot be represented.
- Don't create abstractions for one caller. Duplicate twice, abstract on the third (rule of three); wrong abstractions cost more than duplication.

## Naming
- Names say intent: `unpaidInvoices`, not `data2`. Booleans read as questions: `isExpired`, `hasAccess`.
- Functions are verbs (`calculateTotal`), types are nouns. Units in names when ambiguous: `timeoutMs`, `priceCents`.
- No abbreviations that the reader must decode. Match the domain language users and the codebase already use.

## Types and data
- Strict mode everywhere (TS `strict`, `noUncheckedIndexedAccess` where possible; mypy/pyright strict; Go vet; Rust clippy).
- No `any` / untyped `dict` crossing a module boundary. Parse external data into typed values at the boundary (zod, pydantic, serde, encoding/json with structs).
- Money as integer minor units or a decimal type, never float. Time stored in UTC, with time zones handled at display.
- Prefer immutable data; never mutate function arguments.

## Errors
- Fail loudly and early on programmer errors; handle expected failures (not found, validation, network) explicitly.
- Never swallow an error (`catch {}` / `except: pass`). Either handle it, add context and rethrow, or log it once at the boundary.
- Error messages for users are safe and actionable; details (stack, SQL, internal IDs) go to logs only.
- Every external call has a timeout. Retries only for idempotent operations, with backoff and a cap.
- Clean up resources (`finally`, `with`, `defer`, `using`).

## Comments and docs
- Code says *what*; comments say *why* (a constraint, a trade-off, a link to the bug). Delete comments that restate code.
- Public functions/modules get a short doc comment when the contract isn't obvious from the types.
- No commented-out code; git remembers.

## Hygiene
- No dead code, unused exports, unused dependencies, debug `console.log`/`print`.
- No magic numbers/strings: name them as constants or config.
- Config comes from environment/config files, validated at startup; never hard-coded per-environment values.
- Formatting is the formatter's job; never argue with it in review.
- Commits are small and conventional (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `security:`, `chore:`, `ci:`).

## Frontend specifics
- Components are small and presentational where possible; data fetching and state live in hooks/stores.
- Derive state instead of duplicating it; keep a single source of truth.
- Lists have stable keys; effects have correct dependencies and cleanup.
- Accessible by default: semantic HTML, labels on inputs, keyboard navigation, focus states, alt text, colour contrast.
- React Native / web shared code: platform differences go in `.native.tsx` / `.web.tsx` files, not `Platform.OS` checks scattered through logic.

## Backend specifics
- Validate every input at the edge; return consistent error shapes and correct status codes.
- Database access through a repository/query layer with parameterised queries; transactions around multi-step writes.
- Idempotency keys for payment and other retry-prone writes.
- Pagination on every list endpoint.
