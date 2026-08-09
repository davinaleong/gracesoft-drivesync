# M15 — Observability

Status: **Done**

## What was built

- `prisma/schema.prisma` — added a `SyncStatus` enum (`SUCCESS`/`FAILED`) and four fields to `DriveFolder`: `lastSyncedAt`, `lastSyncStatus`, `lastSyncError`, `consecutiveFailures`. Recorded after *every* sync attempt (not just folder-connection verification), by every path M12's sync run takes — success or failure.
- `prisma/migrations/20260809103624_add_sync_status/` — generated and applied against a real local Postgres before committing.
- `src/folders/folderRepository.ts` — `FolderRepository.recordSyncResult(id, result)`: updates the four new fields; a failure increments `consecutiveFailures`, a success resets it to `0`.
- `src/sync/syncAllFolders.ts` — calls `recordSyncResult` after every folder outcome, and logs a structured `logger.error` (`accountId`, `driveFolderId`, `consecutiveFailures`, `lastError`) once `consecutiveFailures` reaches `REPEATED_FAILURE_THRESHOLD` (3) — the "log signal an alerting system would consume," per the testing checklist's own framing, since no actual alerting integration (PagerDuty, Slack, email) exists to wire this into.
- `src/sync/fileRepository.ts` — added `listForAccount(accountId)`: every synced file across all of an account's folders, what audit aggregation needs.
- `src/observability/observabilityService.ts` — `createObservabilityService({ folderRepository, fileRepository })`:
  - `getStatus(accountId)`: each of the account's folders with `status`, `lastSyncedAt`/`lastSyncStatus`/`lastSyncError`/`consecutiveFailures`, and a computed `fileCount`.
  - `getAudit(accountId)`: `totalFiles`/`totalChunks` across the account, plus a per-folder breakdown. A folder with zero files reports `{ fileCount: 0, chunkCount: 0 }` rather than being omitted.
- `src/observability/observabilityRouter.ts` — `GET /status`, `GET /audit`, both behind `requireApiKey`, wired into `src/server.ts` with an injectable `ObservabilityService` (same DI pattern as every other router in this codebase).

## Decisions

- **"Files processed per account" is interpreted as current file count, not files touched in the last run.** The milestone checklist's wording is ambiguous between the two. Per-run file counts are ephemeral (`FolderSyncSummary`, only ever logged by `worker.ts`, never persisted) — persisting per-run history would mean a new time-series-shaped model (a `SyncRun` table), which is a materially bigger addition than this milestone's four new `DriveFolder` columns. Current file count is directly available from existing `DriveFile` rows and answers the practically useful question ("is this folder's index populated and healthy") without that additional model. Flagged explicitly rather than silently assumed.
- **Repeated-failure detection lives on `DriveFolder`, not a separate alert-state table.** `consecutiveFailures` needs to survive between sync runs to detect a *streak*, but doesn't need its own history — resetting to 0 on success is exactly the semantics needed, and adding it as columns on the existing per-folder row (rather than a new table) keeps `recordSyncResult` a single, atomic update.
- **No alerting integration was built, deliberately.** The testing checklist itself frames this as optional: "Alerting fires (**or the log signal it would consume exists**)." Building a fake Slack/email notifier with no real destination would be scope creep with no real value; the structured `logger.error` call is the actual deliverable a future integration would hook into.
- **`/status` and `/audit` are separate endpoints, not one combined response.** They answer different questions at different granularities (per-folder health vs. account-wide index totals) and a caller checking sync health after connecting a folder has no reason to also pay for computing full audit totals, and vice versa.

## Verified locally

- `npm run lint`, `npm run typecheck`, `npm test` (150 tests passing, up from 139), `npm run build` all pass clean.
- **Live verification** against a real local Postgres (same throwaway-instance approach as every prior migration): seeded a real account, folder, and two files (3 and 2 chunks); called `recordSyncResult` for a success then two consecutive failures and confirmed `consecutiveFailures` reached exactly `2`; called the real `getStatus`/`getAudit` against that data and confirmed `fileCount: 2`, `lastSyncStatus: "FAILED"`, `totalFiles: 2`, `totalChunks: 5` — all correct against genuine database state, not just mocks.

## Explicitly not covered by this pass

- **The repeated-failure log signal has not been observed firing from a real sync run** — only from directly-scripted `recordSyncResult` calls and the unit test's fake `FolderSyncer`. It would need three genuinely consecutive failed sync attempts against a real (or realistically simulated) broken folder to see end to end.

## Next

M16 — Open-source readiness: README for external users, LICENSE confirmed, CONTRIBUTING + issue templates, scrubbed `.env.example`, security disclosure policy, docs site, "Adding a provider" guide.
