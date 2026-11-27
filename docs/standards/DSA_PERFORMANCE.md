# Data structures, algorithms and performance

DSA here is vocabulary for review: spotting the loop-inside-a-loop that should be a hash map, before it reaches production. Measure before optimising, but never ship an obvious O(n²) on unbounded input.

## Review checklist (run on every diff)
- [ ] **Nested loops over collections** that can grow: can the inner lookup be a `Map`/`Set`/`dict`/index? O(n·m) → O(n+m).
- [ ] **`array.includes` / `indexOf` / `find` / `in list` inside a loop** → build a `Set`/`Map` once.
- [ ] **Repeated work inside loops:** regex compilation, JSON parse, date parsing, sorting, DB/API calls. Hoist it out.
- [ ] **Sorting** only when needed; for "top k" use a heap or partial sort. Know the sort is O(n log n).
- [ ] **String building** in loops uses join/builders, not repeated concatenation in languages where that is quadratic.
- [ ] **Recursion depth** is bounded or converted to iteration for user-controlled input.
- [ ] **Unbounded input** (request bodies, uploads, list sizes, regex input) has a size limit. Watch for catastrophic-backtracking regexes (ReDoS).
- [ ] **Memory:** streams/iterators/pagination for large files and result sets instead of loading everything.
- [ ] State the complexity in the PR when touching a hot path ("O(n) per request, n ≤ 500").

## Choosing a structure
| Need | Use |
|---|---|
| Membership / dedupe | Set / hash set |
| Lookup by key | Map / dict / object keyed by id |
| Ordered by key, range queries | Sorted array + binary search, tree map, DB index |
| FIFO work | Queue / deque (not `array.shift()` in a hot loop) |
| Priority / top-k / scheduling | Heap / priority queue |
| Graph / dependencies | Adjacency list + BFS/DFS, topological sort |
| Prefix search / autocomplete | Trie or DB prefix index |
| Counting | Counter / Map<key, number> |
| Sliding window, two pointers | When the problem is "contiguous range" on arrays/strings |

## Databases
- [ ] **No N+1 queries:** a query inside a loop over results → join, `IN (...)`, batch loader (DataLoader), or eager loading.
- [ ] Every `WHERE`, `JOIN` and `ORDER BY` column on a large table has an index; check with `EXPLAIN` / `EXPLAIN ANALYZE`.
- [ ] Select only needed columns; no `SELECT *` in hot paths.
- [ ] Pagination: keyset (cursor) pagination for large/infinite lists, not deep `OFFSET`.
- [ ] Writes that belong together run in one transaction; long transactions are avoided.
- [ ] Counts, aggregates and search over large tables are precomputed or indexed, not computed per request.
- [ ] MongoDB: queries match an index (`explain()`), documents don't grow unbounded arrays, schema validated in code.

## System design basics
- **Caching:** cache expensive, read-heavy, tolerant-of-staleness data. Decide key, TTL, invalidation and what happens on a miss storm. Never cache per-user private data under a shared key.
- **Rate limiting:** every public endpoint, login, signup, password reset, OTP, AI call and webhook has a limit (token bucket / sliding window, keyed by user and IP).
- **Timeouts, retries, circuit breakers** on every network call; retries with exponential backoff + jitter, idempotent operations only.
- **Async work:** slow tasks (email, PDF, AI batch, video) go to a queue/background job, not the request thread.
- **Real-time (WebSockets):** heartbeat, reconnection with backoff, message ordering/dedup, backpressure, auth on connect, room/fan-out limits.
- **Statelessness:** app servers keep no session state in memory if they will be scaled horizontally.

## Frontend performance
- [ ] Bundle: code-split routes, lazy-load heavy components, no whole-library imports for one function.
- [ ] Images: right size and format, lazy-loaded, explicit dimensions (no layout shift).
- [ ] Lists > 100 items are virtualised (FlatList / FlashList on mobile, virtual lists on web).
- [ ] Avoid re-renders: stable props, memoisation only where profiling shows it helps.
- [ ] Debounce/throttle input-driven requests; cancel stale requests.
- [ ] Core Web Vitals budget (LCP < 2.5s, INP < 200ms, CLS < 0.1) checked with Lighthouse for public pages.

## How to verify
- Unit-test the algorithm with edge cases: empty, one element, duplicates, max size.
- Benchmark hot paths (`vitest bench`, `pytest-benchmark`, `go test -bench`, `cargo bench`) when changing them.
- Load-test critical endpoints (k6, autocannon, locust) before launch; record p50/p95/p99 and error rate.
