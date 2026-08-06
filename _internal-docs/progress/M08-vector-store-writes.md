# M8 — Vector store writes

Status: **Done**

## What was built

- `src/vectorstore/vectorStore.ts` — the `VectorStore` interface: `upsert(namespace, records)`, `query(namespace, vector, topK)`, `delete(namespace, ids)`, all namespace-scoped. `VectorRecord` (`id`, `values`, optional `metadata`) and `ScoredVectorRecord` (adds `score`) are provider-agnostic types — deliberately not Pinecone-shaped.
- `src/vectorstore/vectorStore.contract.ts` — `defineVectorStoreContractTests(name, createStore, settleDelayMs?)`, a shared test suite any implementation must pass: upsert-then-query returns the closest match, delete removes a record from subsequent queries, and namespaces stay isolated even when both contain the same vector ID and content. `settleDelayMs` exists for real backends with near-real-time (not immediate) read-after-write consistency — fakes leave it at the default `0`.
- `src/vectorstore/pineconeVectorStore.ts` — `createPineconeVectorStore({ client })`, the reference adapter, plus `createPineconeIndexClient(apiKey, indexName)` wrapping the real `@pinecone-database/pinecone` SDK. Empty `upsert`/`delete` calls are short-circuited rather than sent to the API. `PineconeIndexClient`/`PineconeNamespaceClient` are the injected seam — same DI pattern as `DriveClient`/`OpenAiEmbeddingClient`.
- `src/vectorstore/pineconeVectorStore.test.ts` — runs the generic contract suite against the Pinecone adapter through a fake `PineconeIndexClient` (an in-memory namespace map with real cosine-similarity scoring — good enough to make "closest match" and "namespace isolation" assertions meaningful without needing a live index for every test run), plus adapter-specific tests: empty-list short-circuiting, a missing `score` defaulting to `0` rather than `undefined`, and namespace/vector/topK being passed through correctly.
- `src/vectorstore/index.ts` — `createVectorStore()`, the config-driven registry keyed off `VECTOR_STORE` (currently `pinecone` only), matching M7's `createEmbeddingProvider()` pattern.

## Decisions

- **Stable `{fileId}-{chunkIndex}` vector IDs are the caller's responsibility, not something `VectorStore` enforces.** Same reasoning as M6's chunk-to-file-identity split: `VectorRecord.id` is just a string as far as this interface is concerned. The actual ID scheme gets applied once a sync job (M11/M12) has both a `DriveFile` and its chunks in hand.
- **Metadata type gap between the generic interface and Pinecone's actual constraint, bridged at the adapter boundary.** `VectorRecord.metadata` is typed `Record<string, unknown>` (provider-agnostic — a future adapter might support richer metadata than Pinecone does). Pinecone's SDK constrains metadata values to `string | boolean | number | string[]`. Rather than narrowing the generic interface to Pinecone's constraint, the cast happens only inside `createPineconeIndexClient`'s real implementation — a genuinely incompatible value fails at the real Pinecone call with Pinecone's own error, not silently.
- **The fake `PineconeIndexClient` used for contract testing implements real cosine similarity, not canned responses.** Unlike M7's OpenAI fake client (which can just return fixed vectors, since `EmbeddingProvider`'s contract only checks shape), `VectorStore`'s contract checks *semantic* properties — "the closest vector comes back," "deleted records don't reappear," "namespaces don't leak into each other" — which are meaningless against a fake that doesn't actually do similarity search. This makes the fake more involved than a typical test double, but it's still clearly scoped as a test fixture (lives in the adapter's own test file), not a second shipped `VectorStore` implementation.
- **Real-Pinecone verification was attempted, then explicitly stopped.** The user had earlier opted in to a small amount of real API spend for M7/M8 live verification. When the tool call to actually run the live Pinecone script (create a throwaway serverless index, round-trip through it, delete it) came up, the user rejected it. Per that rejection, live Pinecone verification is **not done** — this milestone is verified only via the mocked contract suite, same as how M3-M5 left real-Drive-API verification explicitly deferred. If real verification is wanted later, the shape of that check (throwaway uniquely-named index, `waitUntilReady: true`, round-trip through two namespaces with overlapping IDs, delete the index in a `finally`) is straightforward to redo — it just hasn't been run against the account's real Pinecone project.

## Verified locally

`npm run lint`, `npm run typecheck`, `npm test` (76 tests passing, up from 69), `npm run build` all pass clean. No live Pinecone or OpenAI credentials used in this pass (see Decisions above) — verification is contract-suite-against-a-fake-client only.

## Explicitly not covered by this pass

- **Real Pinecone API verification** — index creation, upsert/query/delete against a live index, real serverless-index eventual-consistency timing. Tracked under the testing checklist's Integration tests section ("Reference adapters' upsert/delete/query round-trip against real staging infra"), alongside the equivalent OpenAI-half of that same line (which *was* verified live in M7) and the Drive API gap from M3-M5.

## Next

M9 — Provider swap behavior: document and confirm in code that switching `EmbeddingProvider`/`VectorStore` on an existing deployment requires a full resync.
