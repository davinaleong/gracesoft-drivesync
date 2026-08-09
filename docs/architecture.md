# Architecture

## Multi-tenancy

Every tenant is an `Account`. Accounts are operator-provisioned (`npm run account:create`), not self-service — this service shares one Google service-account identity across all tenants for Drive access, so an open signup endpoint would let anyone consume that shared Drive API quota (see [M2](../_internal-docs/progress/M02-accounts-auth.md)).

An account authenticates with an API key (`Authorization: Bearer dsk_...`). The key resolves to an account via `requireApiKey` middleware, and every downstream operation — folder connection, retrieval, MCP tool calls, status/audit — is scoped to that account's ID. In the vector store, the account ID *is* the namespace: there's no shared namespace an account could accidentally read from or write into another tenant's data.

## The sync pipeline

```
DriveClient.listFiles()  →  detectChanges()  →  TextExtractor  →  chunkText()  →  EmbeddingProvider  →  VectorStore.upsert()
   (real Drive API)          (M4, pure diff)     (M5)              (M6)            (M7, pluggable)      (M8, pluggable)
```

Each stage was built and unit-tested independently, several as pure functions before the state they'd eventually consume existed:

- **Change detection** (`src/sync/changeDetection.ts`) diffs a fresh Drive listing against `FileRepository`'s last-known state (`modifiedTime` per file) and classifies each file as added/updated/deleted. It doesn't know or care where "previous state" comes from — that's `FileRepository`'s job, added later in [M11](../_internal-docs/progress/M11-sync-state-persistence.md).
- **Extraction** (`src/extraction/textExtractor.ts`) dispatches on Drive mime type: Docs/Slides export as `text/plain`, Sheets as `text/csv` (first sheet only — a known, flagged limitation), PDFs are downloaded and parsed. Anything that can't produce meaningful text (an unsupported type, a scanned PDF with no text layer) fails closed with a specific reason rather than silently returning empty text.
- **Chunking** (`src/chunking/chunkText.ts`) splits extracted text into token-budgeted chunks with overlap, using `js-tiktoken`'s `cl100k_base` encoding — the same encoding the OpenAI reference embedding provider uses, so chunk sizes measured here are the sizes that provider actually sees. Section/heading metadata comes from a plain-text heuristic (Markdown `#` or Title Case/ALL CAPS short lines), tuned to favor precision over recall: a missed heading just leaves a chunk unattributed, but a false positive would silently drop real content.
- **Dedup** (`src/dedup/`) skips re-embedding a file whose content hash hasn't changed since last sync, and computes exactly which vector IDs are stale when a file is deleted or shrinks to fewer chunks than it had before.
- **Sync orchestration** (`src/sync/syncFolder.ts`, `src/sync/syncAllFolders.ts`) is where all of the above gets composed for real, per folder and across every account, with per-folder failure isolation and per-account rate limiting against the shared Drive quota.
- **Scheduling** (`src/worker.ts`) wraps orchestration in a BullMQ repeatable job on `SYNC_CRON`.

## Pluggable providers

`EmbeddingProvider` and `VectorStore` (`src/embeddings/embeddingProvider.ts`, `src/vectorstore/vectorStore.ts`) are the two seams the pipeline talks to instead of a specific SDK. See [Adding a provider](adding-a-provider.md) for the contribution guide, and [M9](../_internal-docs/progress/M09-provider-swap-behavior.md) for why switching providers on a deployment with existing data requires a full resync (embedding dimension is fixed per provider/model and baked into the vector index at creation time).

## Consuming the index

Two ways to query a connected folder's index, both scoped to the caller's account:

- **REST**: `POST /query` — see [API reference](api-reference.md).
- **MCP**: `search` and `fetch_document` tools, served over streamable HTTP (`src/mcp.ts`), authenticated with the same API key mechanism as the REST API (literally the same `requireApiKey` middleware, not a parallel implementation).

`fetch_document` reconstructs a file's full text from its stored chunks (there's no separate "full document" storage) — see `src/mcp/documentService.ts`.

## Design pattern used throughout

Nearly every external dependency in this codebase (Prisma, the Drive API, OpenAI, Pinecone, Redis) sits behind an interface with an injectable factory: `create<Thing>(deps)`. This is what makes the unit test suite fast and credential-free — business logic is tested against fakes, and only a thin wrapper around the real SDK ever touches a real network call. See any of `src/drive/driveClient.ts`, `src/embeddings/openaiEmbeddingProvider.ts`, or `src/vectorstore/pineconeVectorStore.ts` for the pattern.
