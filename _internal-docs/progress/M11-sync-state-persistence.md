# M11 — Sync state persistence

Status: **Done**

## What was built

- `prisma/schema.prisma` — `DriveFile` model: `accountId`, `driveFolderId` (relation to `DriveFolder`), `fileId` (Drive's raw ID), `name`, `mimeType`, `modifiedTime` (M4's change-detection signal), `contentHash` (M10's dedup signal, nullable), `chunkCount` (M10's stale-vector-cleanup signal), `lastSyncedAt`. Unique on `(driveFolderId, fileId)`. Added `driveFiles DriveFile[]` back-relations on both `Account` and `DriveFolder`.
- `prisma/migrations/20260809084432_add_drive_file/` — generated and applied against a real local Postgres before committing (see Verification below).
- `src/sync/fileRepository.ts` — `FileRepository` interface (`listForFolder`, `upsertSynced`, `deleteByFileIds`) + Prisma-backed implementation, same DI pattern as `FolderRepository` (M3) and `ApiKeyRepository` (M2). `listForFolder` is what feeds M4's `detectChanges` its "previous" snapshot; `deleteByFileIds` is what M4's `deleted` list gets applied against.

## Decisions

- **This model is exactly the state the four pipeline stages built ahead of it need, and nothing more.** `modifiedTime` for M4, `contentHash` for M10's dedup check, `chunkCount` for M10's stale-vector cleanup — each field traces directly back to a pure function already built and tested (M4's `detectChanges`, M10's `hasContentChanged`/`computeStaleVectorIds`) that had no persisted state to read from until now. No speculative columns were added beyond what those modules already require.
- **`FileRepository`'s Prisma implementation isn't directly unit tested, consistent with `FolderRepository`/`ApiKeyRepository`.** It's verified via a real-Postgres smoke test instead (see below) — the same split this codebase has used since M2: interfaces get consumed by pure/injectable logic that's unit tested with fakes, while the concrete Prisma adapter is checked against a real database.
- **No sync orchestration was added here.** It's tempting to wire `detectChanges` + `FileRepository` + extraction + chunking + embedding + `VectorStore` together right now, since all the pieces technically exist — but that composition is explicitly M12's job ("Scheduling... job now iterates every connected folder"). Building it here would blur the milestone boundary and skip the BullMQ/scheduling context M12 wraps it in.

## Verified locally

This environment doesn't have Docker, so a throwaway local Postgres was used again (Homebrew Postgres 18, fresh data directory under `/tmp`, port 5433 — stopped and discarded afterward, same approach as M1/M2/M3).

Against that instance:
1. `npx prisma migrate dev --name add_drive_file` applied all three migrations in sequence (`init`, `add_drive_folder`, `add_drive_file`) to a fresh database and regenerated the Prisma client.
2. `npm run lint`, `npm run typecheck`, `npm test` (97 tests, unchanged — no new unit tests for this milestone, see Decisions), `npm run build` all pass clean.
3. A temporary smoke script (not committed) exercised `FileRepository` against the real database: `upsertSynced` create, `listForFolder` returning it, `upsertSynced` again with different `contentHash`/`chunkCount`/`modifiedTime` confirmed as an update to the *same* row (not a duplicate — the unique constraint on `(driveFolderId, fileId)` is doing its job), `deleteByFileIds` removing it, and confirmed as a no-op on an empty ID list.

CI will independently re-verify the migration applies cleanly via `prisma migrate deploy` against its own fresh Postgres service container on push.

## Next

M12 — Scheduling: BullMQ + Redis job that iterates every connected folder across every account, with per-folder failure isolation and per-account rate limiting. This is where M4, M5, M6, M7, M8, M9, M10, and M11 all finally get composed into one real, running sync pipeline.
