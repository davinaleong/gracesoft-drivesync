# M9 — Provider swap behavior

Status: **Done**

## What was built

- `src/vectorstore/vectorStore.ts` — added `getDimension(): Promise<number | undefined>` to the `VectorStore` interface: the dimension the underlying index/collection was created with, or `undefined` if that isn't knowable yet (a brand-new index with no data reports no dimension). Every implementation now has to answer "what dimension am I currently using," which is the fact the provider-swap check needs.
- `src/vectorstore/pineconeVectorStore.ts` — implemented `getDimension()` via Pinecone's `describeIndexStats()` (its `dimension` field). Added `describeIndexStats()` to the `PineconeIndexClient` seam so this stays consistent with the existing injected-client pattern.
- `src/vectorstore/assertProviderCompatibility.ts` — `assertEmbeddingDimensionMatchesVectorStore(embeddingProvider, vectorStore)`, the actual enforcement: reads the store's current dimension, treats "unknown" (brand-new, empty index) as compatible with anything, and throws a specific, actionable error naming both dimensions and stating the full-resync requirement when they mismatch.
- `src/vectorstore/assertProviderCompatibility.test.ts` — matching dimensions pass, an unknown/brand-new dimension passes, a mismatch throws with both dimension values and "full resync" in the message.
- `src/vectorstore/vectorStore.contract.ts` — added a generic contract test: `getDimension()` must not throw, and if it returns a value, that value must be a positive integer. Kept deliberately loose (not asserting an exact number) since not every implementation necessarily tracks dimension the same way Pinecone does.
- Updated the fake `PineconeIndexClient` in `pineconeVectorStore.test.ts` to implement `describeIndexStats()` (derives a dimension from whatever's been upserted, mirroring how Pinecone only reports a dimension once the index has data), plus two new adapter-specific tests for `getDimension()` (unknown vs. known).

## Decisions

- **The dimension-compatibility fact belongs on `VectorStore`, not bolted on separately.** The milestone asks to "confirm in code" that dimension mismatches are caught — that requires *some* way to ask a `VectorStore` what dimension it's currently using. Adding `getDimension()` to the core interface (rather than, say, a Pinecone-only helper) keeps the enforcement check itself provider-agnostic and means any future `VectorStore` adapter has to answer this question too, not just Pinecone.
- **A vector store with no known dimension yet is treated as compatible with any provider.** A brand-new deployment's first sync run has nothing to conflict with — failing here would block legitimate first-time setup. The check only fires once the store actually has an established dimension to compare against.
- **The enforcement function is built and fully tested, but not yet wired into a running process.** There's no real caller for it yet: the actual sync job that would invoke this at the start of every run doesn't exist until M12 (scheduling). Wiring it into `worker.ts` now would force every worker startup to make real network calls to OpenAI and Pinecone just to check compatibility — unjustified cost for a scaffold that doesn't do any sync work yet. Same "logic now, wiring later" split already used for M4's `detectChanges` and M6's `chunkText`; M12's progress doc should call out invoking `assertEmbeddingDimensionMatchesVectorStore` at the start of every sync run as a concrete requirement, not an afterthought.
- **Not verified against a real Pinecone index.** Consistent with M8: real-Pinecone verification is explicitly deferred per the user's earlier decision to stop that tool call. This means the *real* `describeIndexStats()` → `getDimension()` wiring is untested against the actual API shape, only against the fake client and the SDK's documented response type.

## Verified locally

`npm run lint`, `npm run typecheck`, `npm test` (83 tests passing, up from 76), `npm run build` all pass clean.

## Next

M10 — Dedup & versioning: content-hash skip on unchanged files, stale-vector cleanup on delete.
