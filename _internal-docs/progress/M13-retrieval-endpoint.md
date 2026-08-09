# M13 — Retrieval endpoint

Status: **Done**

## What was built

- `src/sync/syncFolder.ts` — fixed a gap found while starting this milestone: chunk text was never stored in vector metadata during sync (only `fileId`/`name`/`section`), so there was nothing for a retrieval endpoint to return as chunk content. Added `text: chunk.text` to the metadata written on upsert.
- `src/retrieval/retrievalService.ts` — `createRetrievalService({ embeddingProvider, vectorStore })`: embeds the query text, searches the vector store with `accountId` as the namespace (never anything else — the caller's account ID *is* the isolation boundary, per M8), and maps matches back to `{ text, score, fileId, fileName, section? }`. Missing/malformed metadata fields default to empty strings rather than throwing, since a vector written before this milestone (or by a future adapter with looser guarantees) shouldn't crash retrieval.
- `src/retrieval/retrievalRouter.ts` — `POST /query`, validated with zod (`query` required non-empty string, `topK` optional positive integer capped at 50, defaulting to 5). Wired into `src/server.ts` behind `requireApiKey`, with an injectable `RetrievalService` (same DI pattern as `FolderService`).
- `src/retrieval/retrievalService.test.ts` and `retrievalRouter.test.ts` — service-level tests (text/attribution mapping, namespace scoping, missing-metadata defaults, empty-embedding edge case) and router-level tests (200 with results, custom `topK` passthrough, 400 on missing query or over-max `topK`, 401 without a valid key).

## Decisions

- **Chunk text lives in vector metadata, not a separate lookup.** The alternative — storing chunk text only in Postgres and joining it back in at query time — would mean `RetrievalService` needs a `FileRepository`-like dependency just to resolve text, plus a chunk-level (not just file-level) table that doesn't currently exist. Storing `text` directly in the vector's metadata (well within Pinecone's 40KB-per-vector metadata limit for chunks sized by M6's `chunkText`) means retrieval is a single vector store call — simpler, and consistent with the "vector store metadata carries what retrieval needs" pattern already used for `fileId`/`name`/`section`.
- **Missing metadata fields default to empty string/undefined instead of throwing.** A `RetrievalService` that crashes on an unexpected shape (a hand-inserted test vector, a future adapter with different guarantees, or vectors written before this fix landed) is worse than one that degrades gracefully — retrieval returning a chunk with blank attribution is recoverable; a 500 on every query isn't.
- **`topK` is capped at 50, not unbounded.** An unbounded `topK` on someone else's behalf (through the API) has no natural limit otherwise; 50 is generous for typical RAG consumption while bounding the worst case.

## Verified locally

`npm run lint`, `npm run typecheck`, `npm test` (122 tests passing, up from 112), `npm run build` all pass clean.

## Explicitly not covered by this pass

- **No real end-to-end verification** — sync a real folder, then query it and confirm real, meaningful results come back. `syncFolder`'s vector-metadata fix and the retrieval service are each tested in isolation with fakes; the join between them (a real embedded chunk actually being retrievable with correct text) hasn't been exercised against real infrastructure. Would need the OpenAI/Pinecone live setup already used in M7/M8, plus a real connected Drive folder (still blocked on `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, per M3-M5, M12).

## Next

M14 — MCP server exposure: wrap retrieval + document fetch as MCP tools so any MCP-compatible client can search a connected folder.
