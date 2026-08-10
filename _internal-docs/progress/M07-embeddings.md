# M7 — Embeddings

Status: **Done**

## What was built

- `src/embeddings/embeddingProvider.ts` — the `EmbeddingProvider` interface: `embed(texts: string[]): Promise<number[][]>` and a readonly `dimensions`. The pipeline talks to this interface only, never to a specific embeddings API.
- `src/embeddings/embeddingProvider.contract.ts` — `defineEmbeddingProviderContractTests(name, createProvider)`, a shared test suite any implementation must pass: empty input, correct shape/count/dimensions, and surviving input larger than one internal batch. Deliberately only asserts properties that hold for *any* implementation (real or fake) — no adapter-specific behavior.
- `src/embeddings/openaiEmbeddingProvider.ts` — `createOpenAiEmbeddingProvider({ client, model, batchSize?, maxRetries?, sleepFn? })`, the reference adapter: batches requests (default 100 texts/batch), retries transient failures (HTTP 429 or 5xx) with exponential backoff up to `maxRetries` (default 3), and rejects immediately on non-transient errors or an unrecognized model (dimensions are looked up from a fixed table — `text-embedding-3-small` → 1536, `text-embedding-3-large` → 3072, `text-embedding-ada-002` → 1536 — rather than trusting caller input, since a wrong dimension baked into a vector store index is a much worse failure mode than an early, clear error). `createOpenAiEmbeddingClient(apiKey)` is the thin wrapper around the real `openai` SDK.
- `src/embeddings/openaiEmbeddingProvider.test.ts` — runs the generic contract suite against the OpenAI adapter, plus adapter-specific tests: batch-order preservation across multiple batches, retry-then-succeed on a transient failure, no-retry on a non-transient failure, retry exhaustion throwing the underlying error, and rejecting an unknown model at construction time.
- `src/embeddings/index.ts` — `createEmbeddingProvider()`, the config-driven registry keyed off `EMBEDDING_PROVIDER` (currently `openai` only). A contributor adding a new provider implements `EmbeddingProvider` and adds one `case` here — no dynamic plugin loading, per the milestone checklist's explicit guidance.

## Decisions

- **Retry/backoff logic lives in the OpenAI adapter, not the generic interface.** What counts as "transient" (HTTP status codes) is specific to how a given API reports errors — a future Cohere or local-model adapter might have a completely different error shape. The `EmbeddingProvider` interface itself makes no promises about retry behavior; each adapter is responsible for being resilient on its own terms.
- **Model dimensions come from a fixed lookup table, not the API response or caller input.** Baking a wrong dimension into a vector store index (M8) at creation time is expensive to discover and fix later; failing fast at provider construction with a clear error for an unrecognized model is much cheaper than discovering a dimension mismatch mid-sync.
- **The contract suite intentionally stays generic; adapter-specific properties (retry/backoff, exact batch-order via content-derived fixtures) live in the OpenAI-specific test file.** A future contributor's adapter (say, a local embedding model with no batching or retry concept) still has to pass the generic contract suite, but isn't forced to implement OpenAI-shaped retry semantics it may not need.
- **Verified against the real, live OpenAI API, not just mocks** — see below. The user confirmed `.env`'s `OPENAI_API_KEY` is a real credential and explicitly opted in to spending a trivial amount of real API budget for this verification, given the mocked contract/adapter tests alone can't catch an actual SDK-usage mistake (wrong request shape, wrong response field, etc.).

## Verified locally

- `npm run lint`, `npm run typecheck`, `npm test` (69 tests passing, up from 61), `npm run build` all pass clean.
- **Live API check** (temporary script, not committed): called the real `createOpenAiEmbeddingProvider` against the real OpenAI API with the project's actual `OPENAI_API_KEY`/`OPENAI_EMBEDDING_MODEL` (`text-embedding-3-small`), embedding two short strings. Confirmed `provider.dimensions` (1536) matches the actual returned vector length for both, and the SDK call/response wiring (`createOpenAiEmbeddingClient`) works against the real service — not just the mocked contract suite.

## Explicitly not covered by this pass

- **Real API rate-limit/quota behavior under load** — the live check above was two tiny calls, not a stress test. Retry/backoff on genuine 429s from OpenAI has only been verified against a fake client that simulates a 429; tracked under the testing checklist's Integration/Failure-resilience sections alongside the equivalent Drive API gap.

## Next

M8 — Vector store writes: define a `VectorStore` interface (`upsert`, `query`, `delete`, namespace-scoped), ship a Pinecone reference adapter with per-account namespacing and stable vector IDs.

## Addendum (post-M18): OPENAI_EMBEDDING_DIMENSIONS

Found while troubleshooting a real "no objects in the vector store" report: the user's actual Pinecone infrastructure (`drive-sync-dev`, `drive-sync-prod`, and a newly created `gracesoft-drivesync-dev`) was **all 512-dimensional** — but `createOpenAiEmbeddingProvider` had no way to request anything but a model's full native dimension (1536 for `text-embedding-3-small`), so every real sync run failed at M9's dimension check before writing anything.

- `src/embeddings/openaiEmbeddingProvider.ts` — added an optional `dimensions` option, passed through to OpenAI's `embeddings.create` call (the API's own `dimensions` parameter, which truncates a `text-embedding-3-small`/`-large` embedding to a smaller size). Validated at construction: rejects a `dimensions` override on `text-embedding-ada-002` (which doesn't support the parameter at all) or a value exceeding the model's native dimension — same "fail fast at construction, not mid-sync" principle as the unknown-model check.
- `src/config/env.ts` — new optional `OPENAI_EMBEDDING_DIMENSIONS`, wired through `src/embeddings/index.ts`'s registry.
- **Verified end-to-end against the real OpenAI and Pinecone APIs**, not just mocks: requested a real 512-dim embedding, confirmed `assertEmbeddingDimensionMatchesVectorStore` now passes against the real `gracesoft-drivesync-dev` index, upserted and queried the real vector back out, then cleaned it up.
- Also found and flagged (not deleted without asking): a stray leftover Pinecone index (`drivesync-m8-verify-...`) from an earlier live-verification attempt during M8 — a minor cleanup item, unrelated to this fix.
