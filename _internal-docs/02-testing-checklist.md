# GraceSoft DriveSync — Testing Checklist (v2)

Covers the v1-carried-forward pipeline plus everything new in v2 (own auth, multi-tenancy, MCP exposure). Nothing here is done yet — this is the target coverage to build toward alongside the milestones, not a status report.

## Unit tests

- [ ] Change detection: correctly identifies new/updated/deleted files from mock Drive API responses.
- [ ] Content hashing: identical content → identical hash; modified content → different hash.
- [ ] Chunking: correct chunk sizes/overlap, metadata (fileId, title, chunk index, section) attached correctly.
- [ ] Dedup logic: unchanged files skipped on re-sync, only diffs re-embedded.
- [ ] Pinecone ID scheme: stable, collision-free vector IDs (`{fileId}-{chunkIndex}`); upserts don't duplicate.
- [ ] **API key auth**: valid key accepted and resolves to the correct account; missing/malformed/revoked/unknown key all rejected with the same external shape (no signal leak on *why* a key failed).
- [ ] **API key hashing**: key is never recoverable from the stored hash; pepper actually participates in the hash (changing it invalidates all existing keys, confirming it isn't a no-op).

## Multi-tenancy tests

- [ ] Folder connection: pasting a folder ID the service account **can** list succeeds and persists a `DriveFolder` record.
- [ ] Folder connection: pasting a folder ID the service account **cannot** list yet fails with a clear, actionable error (not a generic 500/404).
- [ ] Re-verifying an already-connected folder after access is revoked (unshared) surfaces a clear "no longer accessible" status rather than silently continuing to report it as connected.
- [ ] **Namespace isolation**: account A's retrieval query never returns account B's chunks, even under a shared Pinecone index — test with two real accounts and overlapping/similar content.
- [ ] Sync job iterates every connected folder across every account, not just one; one account's folder list doesn't leak into another's sync run.

## Integration tests

- [ ] Full sync run against a real test Drive folder — add/modify/delete a file, confirm Pinecone + Postgres reflect it correctly after sync.
- [ ] Extraction across file types: Google Docs, Sheets, PDFs, Slides — real fixtures for each, not just Docs.
- [ ] Scanned-PDF OCR (if in scope for v2 launch per the milestone checklist) — real scanned-PDF fixture produces extracted text; if deferred, confirm it still fails closed with a clear `scanned-pdf-ocr-not-implemented` reason rather than silently returning nothing.
- [ ] Pinecone upsert/delete/query round-trip against a real staging index.
- [ ] Prisma migrations apply cleanly to a fresh DB; schema matches the multi-tenant model (accounts, API keys, DriveFolder, DriveFile all correctly related).
- [ ] Retrieval endpoint returns correct top-k chunks **with chunk text included** (v2 change from v1's metadata-only response), plus accurate source attribution.
- [ ] MCP server: tool calls return correctly scoped, correctly shaped results against a real connected folder; an MCP client with an invalid/revoked key is rejected the same way the REST API would reject it.

## Failure & resilience tests

- [ ] Drive API rate limit/429 → retry with backoff, doesn't crash the sync job (a known, carried-forward gap from v1 — worth closing this time).
- [ ] Embedding API timeout/failure → job fails gracefully, no partial/corrupt state, retriable on next run.
- [ ] Pinecone write failure mid-batch → no silent data loss; sync marked failed/partial, not falsely "success".
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