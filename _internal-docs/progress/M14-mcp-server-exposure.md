# M14 — MCP server exposure

Status: **Done**

## What was built

- `src/vectorstore/vectorStore.ts` / `pineconeVectorStore.ts` — added `fetch(namespace, ids)` to the `VectorStore` interface: exact-ID lookup (Pinecone's own `index.namespace(ns).fetch(ids)`), distinct from `query`'s similarity search. Missing IDs are simply absent from the result, not an error. Added to the contract suite (round-trip fetch, empty-list short-circuit).
- `src/sync/fileRepository.ts` — added `findByFileId(accountId, fileId)`: looks up a file's tracking row across all of an account's folders (not just one, unlike `listForFolder`) — what document fetch needs to find `chunkCount` before it can reconstruct anything.
- `src/mcp/documentService.ts` — `createDocumentService({ fileRepository, vectorStore })`: reconstructs a file's full text by fetching all of its chunk vectors (`buildVectorId(fileId, 0..chunkCount-1)`, M10's ID scheme) and joining their `text` metadata (M13's fix) in chunk-index order. There's no separate "full document" storage — the chunks *are* the only copy of the extracted content, so this is the whole implementation.
- `src/mcp/mcpServer.ts` — `createDriveSyncMcpServer({ accountId, retrievalService, documentService })`: registers two tools, `search` (wraps M13's `RetrievalService`) and `fetch_document` (wraps the new `DocumentService`), both scoped to the `accountId` closed over at construction time.
- `src/mcp/mcpRouter.ts` — `createMcpApp({ apiKeyRepository, retrievalService, documentService })`: stateless streamable-HTTP MCP endpoint (`POST /mcp`) — a fresh `McpServer` per request, scoped to whichever account `requireApiKey` resolves the caller's API key to. GET/DELETE (session-oriented operations this stateless server doesn't support) return 405.
- `src/mcp.ts` — standalone entry point, listening on `MCP_SERVER_PORT`, matching `server.ts`/`worker.ts`'s style (`createApp()` export, `if (process.argv[1] === ...)` guard). New `npm run mcp` script.
- Tests: `mcpServer.test.ts` connects a real MCP `Client` to the server over `InMemoryTransport` (genuine protocol round-trip, not just calling the tool callback directly) — tool listing, `search`/`fetch_document` behavior, account scoping, not-found → `isError`. `mcpRouter.test.ts` goes one level further: a real listening HTTP server, a real `StreamableHTTPClientTransport` client, and raw `fetch` for the auth-rejection and method-not-allowed cases.

## A bug found (and fixed) while smoke-testing this milestone

While live-testing the MCP server against a real listening process, an authenticated request with a bogus key **crashed the entire server process** instead of returning 401. Root cause: `requireApiKey` (from M2) is an async Express middleware, and Express 4 doesn't await async handlers — a rejected promise inside one becomes an unhandled rejection that kills the whole Node process, not just that request. The bogus-key path happened to be the one that first exercised a real repository failure (the local `.env`'s `DATABASE_URL` points at a Postgres that isn't running in this environment) — but the same bug means *any* transient DB hiccup during auth, on the REST API or this new MCP endpoint, would have taken the entire server down for every in-flight request, not just the one that hit it.

Fixed in `src/middleware/requireApiKey.ts` by wrapping the repository call in try/catch and routing failures to `next(err)` — Express's built-in error-handling chain then returns a clean 500 instead of the process dying. Added a regression test (`requireApiKey.test.ts`) and re-verified live: the real server survived a real "database unreachable" error and correctly served the next request afterward. This wasn't part of M14's stated scope, but it's exactly the kind of gap "test and make sure it works" is supposed to catch, and it would have been dishonest to file it away as "explicitly not covered" when the fix was small, well-understood, and immediately verifiable.

## Decisions

- **Account scoping happens at `McpServer` construction, not per tool-call.** A fresh server (and its tools) is built per HTTP request, with `accountId` closed over from the already-resolved `req.account.id`. This means there's no way for a tool implementation to accidentally read the wrong account — the account isn't a parameter a tool could get wrong, it's baked into which server instance exists at all.
- **The MCP endpoint is stateless (`sessionIdGenerator: undefined`), matching the SDK's own "simpleStatelessStreamableHttp" reference pattern.** Session-based MCP transport would mean tracking server instances across requests, adding real complexity for a capability (resumable/streaming tool calls) this project's tools don't need — `search` and `fetch_document` are both fire-and-return, not long-running.
- **`fetch_document` returns `isError: true` with a generic message for both "doesn't exist" and "exists but belongs to another account."** Same no-signal-leak principle already applied to API key rejection (M2) and Drive folder access (M3) — an MCP client shouldn't be able to distinguish "no such file" from "that file exists, just not for you."
- **Reused `requireApiKey` directly rather than building separate MCP auth.** The testing checklist's own framing — "an MCP client with an invalid/revoked key is rejected the same way the REST API would" — is trivially true by construction here, since it's literally the same middleware, not a parallel implementation that could drift.

## Verified locally

- `npm run lint`, `npm run typecheck`, `npm test` (139 tests passing, up from 122), `npm run build` all pass clean.
- **Live verification**: started the real `src/mcp.ts` entry point as its own process, confirmed it bound to the configured `MCP_SERVER_PORT` (3001), and drove it with real HTTP requests — an unauthenticated call correctly got 401 without touching the database at all (`looksLikeApiKey` short-circuits first); an authenticated-but-bogus-key call exercised the real (unreachable, in this environment) database path, which is what surfaced the crash bug above; after the fix, the same request cleanly returned 500 and the server remained responsive for the next request.

## Explicitly not covered by this pass

- **No real connected-folder, real-credentials end-to-end verification** — `search` returning genuinely relevant chunks from a real synced Drive folder, or `fetch_document` reconstructing a real multi-chunk file. Blocked on the same real-Drive-credentials gap noted since M3/M5/M12/M13.

## Next

M15 — Observability: structured sync logs, failure alerts, `/status` and `/audit` endpoints.
