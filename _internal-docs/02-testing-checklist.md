
Claude finished the response

Architected adapter pattern for pluggable vector stores and embeddings providers
Architected adapter pattern for pluggable vector stores and embeddings providers
Good instinct — and it's a smaller lift than it sounds, because the seams are already almost in the right place in your milestone structure. M7 (embeddings) and M8 (vector store writes) are already separate milestones, which means the pipeline doesn't currently assume anything about what's in those steps beyond their inputs/outputs. That's the seam to formalize.

The core move: two small interfaces, not a plugin framework

Don't build a general plugin system — that's overkill for two providers and adds maintenance burden. Just define contracts:

typescript
interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  dimensions: number; // needed by vector store setup
}

interface VectorStore {
  upsert(namespace: string, records: VectorRecord[]): Promise<void>;
  query(namespace: string, vector: number[], topK: number): Promise<ScoredChunk[]>;
  delete(namespace: string, ids: string[]): Promise<void>;
}
M7 becomes "implement EmbeddingProvider, ship an OpenAI adapter." M8 becomes "implement VectorStore, ship a Pinecone adapter." Everything upstream (chunking, dedup) and downstream (retrieval endpoint, MCP tools) only ever talks to the interface, never to openai or @pinecone-database/pinecone directly.

Three things that'll bite you if you don't decide them up front

Dimension coupling. Embedding dimension is set by whichever provider you pick (OpenAI's text-embedding-3-small is 1536; others vary), and the vector store's index/collection has to be created with that dimension. This means provider choice can't be purely runtime-swappable without a migration story — switching providers on an existing deployment means re-embedding everything. Worth documenting as expected behavior, not a bug: "changing embedding provider requires a full resync."
Config-driven selection, not code branching. A simple registry/factory keyed off env var (EMBEDDING_PROVIDER=openai, VECTOR_STORE=pinecone) keeps the core pipeline ignorant of which adapter is active. Ship OpenAI + Pinecone as the two reference implementations so the tool works out of the box, but the interface is the contribution surface — someone adds a QdrantVectorStore.ts implementing the same interface, registers it, done. Don't build a dynamic plugin-loading system (npm package discovery, etc.) — that's real complexity for marginal benefit at this stage. A hardcoded registry map that contributors add a line to via PR is enough.
Contract tests, not just unit tests per adapter. This is the one that actually protects you long-term: write a single test suite that runs against any VectorStore implementation (upsert-then-query round-trips, delete removes from subsequent queries, namespace isolation holds) and run it against both Pinecone and whatever second store you or a contributor adds. That's what stops a new adapter from technically compiling but subtly breaking namespace isolation — which, given your testing checklist already treats namespace isolation as a first-class concern, is exactly the property you don't want a new adapter silently violating.
How this touches your two existing docs

Milestones: split M7 into M7 ("define EmbeddingProvider interface + OpenAI adapter") and note the interface as the actual deliverable, adapter as reference impl. Same split for M8 with VectorStore/Pinecone. Worth adding a short "Adding a provider" doc as part of M15, since that's the whole point of making it modular for contributors.
Testing checklist: add the contract-test suite as its own line under Unit tests, distinct from the existing Pinecone-specific items (which become "Pinecone adapter passes the VectorStore contract suite" rather than bespoke Pinecone tests).
Want me to sketch the fuller interface definitions (including what a chunk/record type and error handling should look like across providers), or draft the milestone/testing doc edits for this split?

update the 2 checklists


Synthesized documentation updates across multiple architectural components
Synthesized documentation updates across multiple architectural components
Let me renumber cleanly rather than leave the "M9a" patch in place.


Renumber milestones sequentially after inserting new item
Renumber milestones sequentially after inserting new item
Now update the intro line, stack decision (already generic), and M15/deferred section for provider docs and to reflect Pinecone/OpenAI as reference implementations rather than fixed choices.


Edited 3 files, ran a command
Edited 3 files, ran a command
Now let's view the full file to sanity-check before moving to the testing checklist.


Viewing file
Viewing file
That reads well. Now the testing checklist — add contract-test coverage for both interfaces, and reframe the existing Pinecone-specific tests as instances of that contract suite.


Edited 2 files
Edited 2 files
Now update the multi-tenancy namespace isolation item to reference the contract suite rather than being Pinecone-specific, and adjust the integration test for Pinecone round-trips similarly.


Edited 2 files
Edited 2 files
Let's view the full testing file to confirm it holds together.


Viewing file
Viewing file
A couple leftover Pinecone-specific mentions (lines 11, 27, 40) should be generalized too, since the store is no longer assumed to be Pinecone.


Edited 3 files
Edited 3 files
Now copy both finished files to outputs and share them.


Ran a command, read a file
Ran a command, read a file
Both updated. Summary of what changed:

Milestones: M7/M8 now define EmbeddingProvider/VectorStore interfaces with Pinecone/OpenAI as reference adapters, not hard dependencies; new M9 documents the provider-swap/resync constraint; M16 gets an "Adding a provider" doc requirement; stack decision note updated; everything renumbered through M18.

Testing: added VectorStore and EmbeddingProvider contract-test suites that any adapter (including future contributor ones) must pass; namespace isolation and vector-ID tests reframed as provider-agnostic; added a provider-swap integration test; leftover Pinecone-specific wording elsewhere generalized to "vector store."


01 milestone checklist
Document · MD 

02 testing checklist
Document · MD 





Claude is AI and can make mistakes. Please double-check responses.


02 testing checklist · MD
# GraceSoft DriveSync — Testing Checklist (v2)
 
Covers the v1-carried-forward pipeline plus everything new in v2 (own auth, multi-tenancy, MCP exposure, pluggable embedding/vector-store providers). Nothing here is done yet — this is the target coverage to build toward alongside the milestones, not a status report.
 
## Unit tests
 
- [x] Change detection: correctly identifies new/updated/deleted files from mock Drive API responses. `src/sync/changeDetection.test.ts` — added/updated/deleted individually and in combination.
- [ ] Content hashing: identical content → identical hash; modified content → different hash.
- [x] Chunking: correct chunk sizes/overlap, metadata (fileId, title, chunk index, section) attached correctly. `src/chunking/chunkText.test.ts` covers token-budgeted splitting, overlap (including overlap never crossing a section boundary), heading/section detection, and edge cases (empty text, invalid options). `chunkText` itself only produces `index`/`section`/`tokenCount` — `fileId`/`title` are the caller's job to attach once M11's `DriveFile` model exists to source them from.
- [ ] Dedup logic: unchanged files skipped on re-sync, only diffs re-embedded.
- [ ] Vector ID scheme: stable, collision-free vector IDs (`{fileId}-{chunkIndex}`); upserts don't duplicate — provider-agnostic, covered as part of the `VectorStore` contract suite.
- [x] **API key auth**: valid key accepted and resolves to the correct account; missing/malformed/revoked/unknown key all rejected with the same external shape (no signal leak on *why* a key failed). `src/middleware/requireApiKey.test.ts`.
- [x] **API key hashing**: key is never recoverable from the stored hash; pepper actually participates in the hash (changing it invalidates all existing keys, confirming it isn't a no-op). `src/auth/apiKeyCrypto.test.ts`.
- [x] **`VectorStore` contract suite**: a single provider-agnostic test suite (upsert-then-query round-trips, delete removes from subsequent queries, namespace isolation holds) that runs against any implementation. The Pinecone adapter must pass it; any contributor-added adapter (Qdrant, Weaviate, pgvector, etc.) is required to pass the same suite before merge — this is what stops a new adapter from silently breaking namespace isolation. `src/vectorstore/vectorStore.contract.ts`, run against the Pinecone adapter via a fake in-memory Pinecone client (real cosine-similarity search, real per-namespace isolation) in `pineconeVectorStore.test.ts`. Real-Pinecone verification not yet performed — see progress doc.
- [x] **`EmbeddingProvider` contract suite**: shared test suite (correct output shape/dimensions, batch size handling, retry/backoff on transient failure) that runs against any implementation, starting with the OpenAI adapter. `src/embeddings/embeddingProvider.contract.ts` (provider-agnostic: empty input, shape/dimensions, more-than-one-batch input) + `src/embeddings/openaiEmbeddingProvider.test.ts` (adapter-specific: batch-order preservation, retry/backoff on 429/5xx, no-retry on non-transient errors, retry exhaustion, unknown-model rejection).
## Multi-tenancy tests
 
- [x] Folder connection: pasting a folder ID the service account **can** list succeeds and persists a `DriveFolder` record. Verified via unit tests (`folderService.test.ts`, `foldersRouter.test.ts`) and an end-to-end smoke pass against a real local Postgres (stubbed `DriveClient` — no real GCP credentials wired yet).
- [x] Folder connection: pasting a folder ID the service account **cannot** list yet fails with a clear, actionable error (not a generic 500/404). Verified: `422` with a "Share it with `<service-account-email>`" message.
- [x] Re-verifying an already-connected folder after access is revoked (unshared) surfaces a clear "no longer accessible" status rather than silently continuing to report it as connected. Verified: `POST /folders/:id/verify` updates status to `NOT_ACCESSIBLE` and returns it with an error message, `200` not `500`.
- [ ] **Namespace isolation**: account A's retrieval query never returns account B's chunks, even under a shared index/collection — test with two real accounts and overlapping/similar content. Runs against whichever `VectorStore` adapter is active (part of the contract suite above), not just Pinecone.
- [ ] Sync job iterates every connected folder across every account, not just one; one account's folder list doesn't leak into another's sync run.
## Integration tests
 
- [ ] Full sync run against a real test Drive folder — add/modify/delete a file, confirm the configured vector store + Postgres reflect it correctly after sync.
- [ ] Extraction across file types: Google Docs, Sheets, PDFs, Slides — real fixtures for each, not just Docs.
- [x] Scanned-PDF OCR (if in scope for v2 launch per the milestone checklist) — real scanned-PDF fixture produces extracted text; if deferred, confirm it still fails closed with a clear `scanned-pdf-ocr-not-implemented` reason rather than silently returning nothing. **Deferred** per M5 decision (known v1 gap, explicit fast-follow, not v2-launch scope). Fail-closed behavior confirmed: `src/extraction/textExtractor.test.ts` (a PDF whose parsed text is empty/whitespace returns `{ ok: false, reason: "scanned-pdf-ocr-not-implemented" }`, never silently empty text) plus a manual sanity check against a real generated PDF.
- [ ] Reference adapters' upsert/delete/query round-trip against real staging infra: Pinecone for `VectorStore`, OpenAI for `EmbeddingProvider` (beyond the mocked contract suite — real API behavior, quotas, latency).
- [ ] **Provider swap**: switching `EmbeddingProvider`/`VectorStore` config on a deployment with existing data behaves as documented (fails clearly or triggers full resync — not silent corruption or mixed-dimension writes).
- [ ] Prisma migrations apply cleanly to a fresh DB; schema matches the multi-tenant model (accounts, API keys, DriveFolder, DriveFile all correctly related).
- [ ] Retrieval endpoint returns correct top-k chunks **with chunk text included** (v2 change from v1's metadata-only response), plus accurate source attribution.
- [ ] MCP server: tool calls return correctly scoped, correctly shaped results against a real connected folder; an MCP client with an invalid/revoked key is rejected the same way the REST API would reject it.
## Failure & resilience tests
 
- [ ] Drive API rate limit/429 → retry with backoff, doesn't crash the sync job (a known, carried-forward gap from v1 — worth closing this time).
- [ ] Embedding API timeout/failure → job fails gracefully, no partial/corrupt state, retriable on next run.
- [ ] Vector store write failure mid-batch → no silent data loss; sync marked failed/partial, not falsely "success".
- [ ] Malformed/corrupted file in a folder → skipped with a logged warning, doesn't halt the rest of that account's sync or any other account's.
- [ ] Concurrent sync runs (scheduled job overlaps a manual trigger, or two accounts sync simultaneously) → locking prevents duplicate/conflicting writes without serializing unrelated accounts unnecessarily.
- [ ] **Per-account failure isolation**: one account's broken/inaccessible folder doesn't stall or fail other accounts' syncs in the same run.
- [ ] **Per-account rate limiting**: one account can't monopolize the shared service account's Drive API quota — confirm a heavy account gets throttled without starving others.
## Scheduling & observability
 
- [ ] Cron/queue trigger fires reliably on schedule.
- [ ] Sync status endpoint reflects last run time, success/failure, and files processed per account.
- [ ] Audit endpoint reports accurate full index state (total files/chunks) scoped to the caller's own account.
- [ ] Alerting fires (or the log signal it would consume exists) on repeated sync failures for a given account.
## Open-source readiness tests
 
- [ ] Fresh clone + documented setup steps (README quickstart) actually gets a new contributor to a running local instance without tribal knowledge.
- [ ] `.env.example` has no leftover real values, and the app fails fast with a clear message on any missing required var.
- [ ] CI pipeline (lint/typecheck/test/build) passes on a clean checkout — no repeat of v1's silent-env-stripping or uninstalled-eslint bugs.
