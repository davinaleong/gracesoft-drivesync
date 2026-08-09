# M12 — Scheduling

Status: **Done**

This is the milestone where M4 (`detectChanges`), M5 (extraction), M6 (`chunkText`), M7 (`EmbeddingProvider`), M8 (`VectorStore`), M9 (`assertEmbeddingDimensionMatchesVectorStore` — see Explicitly not covered), M10 (`contentHash`/`vectorIds`), and M11 (`FileRepository`) all finally get composed into one real, running sync pipeline.

## What was built

- `src/scheduling/concurrencyLimiter.ts` — `createConcurrencyLimiter(maxConcurrentPerKey)`: a per-key semaphore. Enforces `DRIVE_RATE_LIMIT_PER_ACCOUNT` by capping concurrent *folder syncs* per account (see Decisions for why that approximates capping concurrent Drive API calls). Different keys never block each other.
- `src/sync/syncFolder.ts` — `createFolderSyncer(deps)`, the per-folder orchestration: lists current Drive files, diffs against `FileRepository`'s last-known state (M4), extracts (M5) and hashes (M10) each added/updated file, skips re-embedding when the hash is unchanged (still bumping `modifiedTime`/`lastSyncedAt` so the file isn't rechecked from scratch every run), chunks (M6) and embeds (M7) changed content, upserts vectors into the account's namespace (M8), cleans up stale vectors for shrunk or deleted files (M10), and records the new state (M11). Extraction failures and unexpected per-file errors are caught and recorded in the summary's `failedFiles`, not thrown — one bad file doesn't stop the rest of the folder.
- `src/sync/syncAllFolders.ts` — `createSyncRunner(deps)`: before touching any folder, calls M9's `assertEmbeddingDimensionMatchesVectorStore` once — a provider/model swap fails the whole run immediately and clearly, rather than partway through. Then lists every `CONNECTED` folder across every account (`FolderRepository.listAllConnected`, added this milestone) and syncs them all, routing each through the concurrency limiter keyed by `accountId`. Per-folder failure isolation: each folder's sync is wrapped in try/catch and reported as an outcome, never allowed to reject the overall run.
- `src/worker.ts` — replaced the M1 scaffold with real wiring: builds the full dependency graph (`DriveClient`, `FileRepository`, `TextExtractor`, tokenizer, `EmbeddingProvider`, `VectorStore`, `ConcurrencyLimiter`) once at startup, registers a BullMQ `Worker` that runs `syncRunner.runSync()` on each job, and schedules a repeatable job on `SYNC_CRON` with a fixed `jobId` (`scheduled-sync`) so restarting the worker reschedules the same job instead of accumulating duplicates. Logs a run summary (folder count, failed count) and a warning listing failures.
- Unit tests: `concurrencyLimiter.test.ts` (max-concurrency enforcement, per-key isolation, FIFO ordering, rejection propagation), `syncFolder.test.ts` (added/updated/skipped-unchanged/deleted files, shrunk-chunk-count cleanup, extraction failures and unexpected errors both recorded without throwing), `syncAllFolders.test.ts` (every folder gets an outcome, one folder's failure doesn't affect others, per-account concurrency capping verified against a different account running unimpeded, and a dimension mismatch fails the whole run before any folder is touched).

## Decisions

- **Rate limiting caps concurrent folder syncs per account, not literal concurrent Drive API calls.** Precisely limiting individual Drive calls would mean threading the limiter through every `DriveClient` method call site. Since each folder sync processes its files sequentially (one extraction/Drive call at a time, not parallelized within a folder), capping concurrent folder syncs per account to `DRIVE_RATE_LIMIT_PER_ACCOUNT` closely approximates capping concurrent Drive calls per account, at a fraction of the complexity. Flagged explicitly rather than silently assumed equivalent.
- **A skipped-unchanged file still gets `upsertSynced` called, updating `modifiedTime` and `lastSyncedAt`.** Without this, a file whose `modifiedTime` changed but content hash didn't (a metadata-only touch) would be re-detected as "updated" and re-extracted on every subsequent sync run forever, since `FileRepository`'s stored `modifiedTime` would never catch up. Only the expensive chunk/embed/upsert steps are actually skipped.
- **`jobId: "scheduled-sync"` on the repeatable job.** BullMQ's repeatable jobs would otherwise accumulate a new repeat entry every time the worker restarts (deploys, crashes, manual restarts) unless the same key is reused. A fixed ID makes registering the schedule idempotent.
- **Per-file errors are caught inside `syncFolder`, per-folder errors inside `syncAllFolders` — two isolation layers, not one.** A bug or transient failure on a single file (one bad PDF, one Drive API hiccup) shouldn't fail the whole folder any more than one folder's failure should fail the whole run. Both layers were exercised in the live verification below (a nonexistent Drive folder failed at the per-folder layer without touching the worker process itself).
- **No sync-status/audit endpoint was added.** That's explicitly M15 (Observability) — this milestone's logging (run summary, per-folder failures) is what M15 will build structured status reporting on top of, not a substitute for it.

## Verified locally

- `npm run lint`, `npm run typecheck`, `npm test` (111 tests passing, up from 97), `npm run build` all pass clean.
- **Live end-to-end run** against real throwaway infrastructure (Homebrew Postgres + Redis, both discarded afterward): seeded a real account and a `CONNECTED` `DriveFolder` pointing at a made-up folder ID, started the actual `worker.ts` (not a mock), confirmed it registered the repeatable job (`cron: "*/15 * * * *"` logged), then manually enqueued a one-off job on the same BullMQ queue from a separate process to trigger a sync run immediately rather than waiting for the schedule. The worker picked it up, queried the real Postgres for connected folders, called the real Google Drive API for the fake folder ID (received a real `File not found` response — Drive API auth appears to be working now, unlike the broken `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` flagged back in M3, though re-verifying that wasn't this milestone's job), caught the failure at the per-folder layer, logged it via `logger.warn`, and kept running without crashing.

## Explicitly not covered by this pass

- **The repeatable cron schedule itself was not observed firing on its own** — only the registration (`repeat: { pattern }`) and a manually-triggered job were verified. Waiting a full `SYNC_CRON` interval (15 minutes by default) to observe an unattended fire wasn't done in this pass.
- **Real embedding/vector-store calls during a live sync were not exercised** (the smoke test's folder failed at the Drive-listing step, before extraction/embedding/upsert would run) — M7/M8's live verification already covered those adapters directly, but not yet as part of a full sync run.

## Next

M13 — Retrieval endpoint: query API returning top-k chunks with text and attribution, scoped to the caller's own namespace.
