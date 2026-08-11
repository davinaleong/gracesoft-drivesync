# M15 addendum — file-level sync logging (post-M18 fix)

Status: **Done**

## What prompted this

Found live during a local test run of `npm run worker` against a real connected
folder: the only sync-related log lines emitted were `sync run started` /
`sync run completed` (aggregate counts across *every* folder in the run) and
the M15 repeated-failure signal. Nothing logged what actually happened to the
files inside the one folder being synced — no line said a given file was
added, updated, skipped, or deleted. The M15 progress doc had assumed
`FolderSyncSummary` was "only ever logged by `worker.ts`"; in fact `worker.ts`
never logged the per-folder breakdown at all, only a total across the whole
run, so that assumption was wrong in practice.

## What was built

- `src/sync/syncFolder.ts` — `createFolderSyncer` now logs one line per file
  as each outcome is decided: `logger.info` for `file added` / `file updated`
  / `file deleted` (with `accountId`, `driveFolderId`, `fileId`, `fileName`,
  and `chunkCount` where relevant), `logger.debug` for `file unchanged,
  skipped`, and `logger.warn` for `file sync failed` / `file delete failed`
  (extraction failures and unexpected errors alike, at the point they're
  caught — previously these only surfaced later, aggregated, in
  `worker.ts`).
- `src/sync/syncAllFolders.ts` — logs a `folder sync completed` line per
  folder (`accountId`, `driveFolderId`, `added`, `updated`, `deleted`,
  `skippedUnchanged`, `failedFileCount`) right after `folderSyncer.syncFolder`
  returns, so a run against one folder shows that folder's own breakdown
  instead of only the run-wide aggregate `worker.ts` logs at the end.

`worker.ts`'s existing aggregate `sync run completed` log is unchanged and
still useful for a multi-folder run at a glance; these are additive, more
granular layers underneath it.

## Decisions

- **Skipped-unchanged files log at `debug`, everything else at `info`/`warn`.**
  A folder that's already fully synced can have hundreds of unchanged files
  every run; logging those at `info` by default would drown out the
  added/updated/deleted/failed signal that's actually actionable. They're
  still visible by setting `LOG_LEVEL=debug` locally.
- **Failures are logged at the point they're caught in `syncFolder.ts`, not
  only aggregated afterward.** `worker.ts`'s existing aggregate
  `filesFailedWithinSuccessfulFolders` warning is left in place — it's still
  the right summary for "did this run have any problems" — but per-file
  logging means a failure is visible in-context (immediately after the file
  that caused it) rather than only in a bundled list at the very end.

## Verified locally

- `npm run typecheck`, `npm run lint`, `npm test` — all pass clean (162
  tests, no regressions).
- Ran `src/sync/syncFolder.test.ts` and `src/sync/syncAllFolders.test.ts`
  directly and inspected the emitted log lines: confirmed `file added`,
  `file updated`, `file deleted`, `file sync failed`, and `folder sync
  completed` all appear with the expected fields for the corresponding test
  scenarios (new file, content-changed file, deleted file, extraction
  failure, unexpected vector-store error).

## Next

None outstanding from this fix. Remaining open items are the pre-existing
ones on the testing checklist (full sync run against a real test Drive
folder, extraction across real file-type fixtures, concurrent-sync locking)
and M18's actual deploy execution.
