# M17 — Testing & CI

Status: **Done**

Most of this milestone's infrastructure already existed by the time it was reached — CI (lint/typecheck/prisma migrate/test/build against fresh service containers) has been running on every push since M3. This milestone's actual work was a genuine review pass over the testing checklist to find and close real gaps, not just re-confirm what was already true.

## What was found and fixed

- **Drive API 429/5xx had no retry at all** (the exact "known, carried-forward gap from v1" the checklist calls out). `src/drive/driveClient.ts` — added `withRetry` (exported for direct testing), wrapping all four real Drive API calls (`verifyFolderAccess`, `listFiles`, `exportAsText`, `downloadFile`) with exponential backoff on 429/5xx; non-retryable statuses (404/403) pass straight through unretried so `verifyFolderAccess`'s existing classification logic still runs on the first attempt. `createGoogleDriveClient` gained an optional `{ maxRetries, sleepFn }` for testability, defaulting to the same values every other adapter in this codebase uses. `src/drive/withRetry.test.ts` — 6 tests (retry-then-succeed on 429 and 5xx, non-retryable passthrough, retry exhaustion, backoff timing).
- **Per-file failures inside an otherwise-successful folder sync were invisible in the logs.** `worker.ts` only ever logged folder-*level* failures (`!outcome.ok`); a file that failed extraction (unsupported type, scanned PDF) inside a folder that synced successfully overall was recorded in `summary.failedFiles` but never surfaced anywhere an operator would see it. Fixed: `worker.ts` now flattens `failedFiles` across every successful folder outcome and logs them with `logger.warn`.
- **Two testing checklist lines were already true but never marked**, found during the review pass: "Content hashing" (M10's `contentHash.test.ts` already covers this exactly) and "Namespace isolation" (already covered by the `VectorStore` contract suite's isolation test).

## What was verified live, not just by unit test

- **The repeatable cron schedule actually fires unattended** — the one piece of M12's own "explicitly not covered" list. Ran the real worker with `SYNC_CRON="*/1 * * * *"` against real (throwaway) Redis and watched it fire at 7 consecutive exact 60-second boundaries with zero manual triggering.
- This live run also surfaced something real about the user's actual deployment, not a test artifact: the configured `OPENAI_EMBEDDING_MODEL` (`text-embedding-3-small`, 1536 dimensions) doesn't match the real Pinecone index's existing dimension (512). M9's `assertEmbeddingDimensionMatchesVectorStore` correctly caught this and failed every run closed, exactly as designed — but it means **the real production configuration would fail every sync run today** until the mismatch is resolved (either point `PINECONE_INDEX_NAME` at a 1536-dim index, create one, or switch to a 512-dim-producing embedding setup). Worth the user's attention independent of this milestone.

## Decisions

- **No cross-process locking was built for the "concurrent sync runs" checklist item.** What's already true by construction: BullMQ's default `Worker` concurrency (1) means a single process never runs two jobs simultaneously, BullMQ's own per-job lock stops the *same* job being double-processed if multiple worker processes exist, and per-account rate limiting (M12) already isolates different accounts' syncs. What's genuinely missing: a lock preventing two *different* jobs (a scheduled tick and a manual trigger, running on different worker processes) from both processing the *same* folder concurrently. Building a Redis-based per-folder lock now, with no evidence horizontal worker scaling is an actual deployment pattern for this project yet, would be speculative infrastructure. Flagged explicitly in the testing checklist rather than either building it prematurely or silently claiming it's covered.
- **Real Drive/Pinecone integration tests (real folder, real file-type fixtures, real Pinecone round-trip) remain open**, and reasonably so: closing them requires either the user sharing real Drive content of each file type with the service account, or resolving the dimension mismatch just discovered — both are the user's call, not something to fabricate or force through.

## Verified locally

`npm run lint`, `npm run typecheck`, `npm test` (156 tests passing, up from 150), `npm run build` all pass clean, plus the two live checks described above (retry logic verified via mocked unit tests since there's no injected-client seam on `DriveClient` to fake a real 429 through — the cron-firing and dimension-mismatch discovery were both against real, live infrastructure).

## Next

M18 — Deploy: staging + production environment, migration runbook, domain/DNS. Hosting target not yet decided — needs the user's input.
