# AI / LLM features

An AI feature isn't done when the demo works. It's done when you can show, with numbers, how often it's right, how it fails, what it costs, and why it can't be talked into doing harm.

## 1. Evals (record them in `EVALS.md`)
- **Known-answer set:** at least 20 realistic inputs whose correct output you know. Score each: pass / fail / partial, with the rule you used.
- **Should-refuse / out-of-scope set:** at least 5 inputs where the right answer is "I don't know", "not in the source", or a refusal. This is how you catch hallucination.
- **Adversarial set:** prompt-injection strings inside user content and retrieved documents ("ignore previous instructions and..."), oversized input, other languages, malformed data.
- **Regression:** every production bug becomes a new eval case.
- **How to score:** exact match / schema validity / contains-required-facts in code where possible; an LLM-as-judge only with a written rubric, spot-checked by a human.
- Re-run evals whenever the prompt, model, retrieval or temperature changes; record the date, model ID and score so changes are comparable.
- Keep eval inputs fictional or properly anonymised.

## 2. Output handling
- Ask for structured output (JSON schema / tool call) and **parse + validate** it (zod/pydantic). Reject or repair invalid output; never `eval` it or pass it raw into SQL, HTML, shell, URLs or file paths.
- Enforce business rules in code, not only in the prompt (e.g. "only choose from these IDs" is checked after the call).
- Show uncertainty to users; cite sources for retrieval answers; let users correct the output.

## 3. Prompt injection and tool safety
- Everything not written by you (user input, web pages, emails, documents, tool results) is **data, not instructions**. Wrap it in clearly delimited, labelled blocks.
- Give the model the minimum tools and permissions; prefer read-only.
- Any outward or destructive action (sending, paying, deleting, posting, changing permissions) requires explicit human confirmation outside the model.
- Never put secrets, API keys or other users' data in the context window.

## 4. Cost and speed
- **Pick the smallest model that passes the evals.** Try the cheaper tier first; move up only for the cases that need it (routing).
- **Send only what's relevant:** retrieve the 3–5 most relevant chunks (embeddings / BM25 / hybrid) instead of the whole document each time.
- Use prompt caching for long, stable system prompts and documents; batch APIs for non-urgent bulk work.
- Set `max_tokens`, timeouts, and per-user rate limits. Stream long responses for perceived speed.
- **Track it:** log per request the model, input/output tokens, latency and estimated cost; put totals in `EVALS.md` and a dashboard. Set a spend alert.

## 5. Reliability
- Handle 429 / 5xx / timeouts with backoff, and have a fallback (another model/provider or a graceful "try again").
- Make calls idempotent where retries could duplicate side effects.
- Version prompts in code (not only in a dashboard) so changes are reviewed and diffable.

## 6. Privacy and policy
- Tell users when content is AI-generated and what data is sent to which provider.
- Check the provider's data-retention settings; don't send regulated data (health, card numbers) without an agreement that allows it.

## `EVALS.md` minimum contents
1. What the feature does and which model(s) it uses.
2. The eval sets (or a link to the fixtures file) and how each case is scored.
3. Latest results table: date, model, prompt version, pass rate per set, avg latency, avg cost per call.
4. Known failure modes and what's being done about them.
