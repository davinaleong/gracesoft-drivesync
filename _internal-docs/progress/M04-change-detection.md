# M4 — Change detection

Status: **Done**

## What was built

- `src/drive/driveClient.ts` — added `DriveFileMeta` (`id`, `name`, `mimeType`, `modifiedTime`) and `listFiles(folderId)` to the `DriveClient` interface. The Google implementation lists direct children only (no recursion — the connected-folder model is single-level), excludes trashed items and subfolders (only actual files are sync candidates), and paginates via `nextPageToken`.
- `src/sync/changeDetection.ts` — `FileSnapshot` (`id`, `modifiedTime`) and a pure `detectChanges(previous, current)` function returning `{ added, updated, deleted }`. Deliberately not tied to any storage: it diffs two snapshots and nothing else. Where "previous" is persisted between sync runs (Postgres via the `DriveFile` model) is explicitly M11's job, not this one.
- `src/sync/changeDetection.test.ts` — added/updated/deleted individually and in combination, plus the "no previous state" (everything is new) case.
- Updated `src/folders/folderService.test.ts`'s fake `DriveClient` objects to implement the new `listFiles` method (they previously only implemented `verifyFolderAccess`; TypeScript's structural typing caught this immediately once `listFiles` became part of the interface — a good sign the interface change is real, not just additive-and-ignorable).

## Decisions

- **Change detection is a pure diff function, not a stateful service.** The milestone checklist scopes M4 as "list folder contents... detect new/updated/deleted" and separately scopes M11 as "`DriveFile` model... sync state persistence." Rather than build a partial persistence layer now and redo it at M11, `detectChanges` takes `previous: FileSnapshot[]` as a plain argument — any caller (a future M11 sync job, or a test) supplies it. This mirrors the same "interface now, concrete adapter later" split already used for `EmbeddingProvider`/`VectorStore` (M7-M9).
- **`listFiles` returns direct children only, excludes subfolders and trashed items.** The milestone description doesn't call for recursive folder traversal, and the `DriveFolder` model is single-level (one `folderId` per connection) — recursion would be scope creep without a corresponding data model to support it.
- **Change comparison keys on `modifiedTime` only, not content hash.** Content-hash-based dedup is explicitly M10's job ("content-hash skip on unchanged files"); M4 only needs to decide *which* files to hand to that later stage, using the cheap signal (Drive's own `modifiedTime`) rather than duplicating M10's work early.

## Verified locally

`npm run lint`, `npm run typecheck`, `npm test` (43 tests passing, up from 38), `npm run build` all pass clean. No database or live Google Drive credentials needed for this milestone — `detectChanges` is a pure function tested directly, and `listFiles`'s real Drive API call follows the same untested-at-this-layer convention as `verifyFolderAccess` (both are thin wrappers exercised indirectly via a fake `DriveClient` elsewhere; direct integration testing against real Drive credentials is tracked in the testing checklist's Integration tests section).

## Next

M5 — Extraction pipeline: Docs/Sheets/PDFs/Slides → plain text.
