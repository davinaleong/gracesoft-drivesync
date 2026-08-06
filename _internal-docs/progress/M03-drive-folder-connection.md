# M3 — Drive folder connection (multi-tenant)

Status: **Done**

## What was built

- `prisma/schema.prisma` — `DriveFolder` model (`accountId`, `folderId`, `status`, `connectedAt`, `lastVerifiedAt`, unique on `(accountId, folderId)`) and `FolderStatus` enum (`CONNECTED`, `NOT_ACCESSIBLE`). `driveFolders DriveFolder[]` back-relation on `Account`.
- `prisma/migrations/20260806045227_add_drive_folder/` — generated and applied against a real local Postgres before committing (see Verification below).
- `src/drive/driveClient.ts` — `DriveClient` interface + `createGoogleDriveClient()`. Uses `googleapis`' `google.auth.JWT` with the service-account email/private key from env, calls `drive.files.get` on the pasted folder ID, and classifies the result as accessible / `not-found-or-not-shared` (Drive returns 404 for both "doesn't exist" and "exists but not shared with us" — it won't confirm existence to a caller without access) / `not-a-folder` (wrong mime type).
- `src/folders/folderRepository.ts` — `FolderRepository` interface + Prisma-backed implementation (`upsertConnected`, `markVerified`, `findByIdForAccount`, `listForAccount`).
- `src/folders/folderService.ts` — `FolderService` (`connectFolder`, `verifyFolder`, `listFolders`), composed from an injected `DriveClient` + `FolderRepository` so it's testable without a live DB or real Google API.
- `src/folders/foldersRouter.ts` — `POST /folders` (connect, verifies before persisting, 422 with an actionable share-with-this-email message on failure), `GET /folders` (list, scoped to caller's account), `POST /folders/:id/verify` (re-verify an existing folder; on revoked access, updates status to `NOT_ACCESSIBLE` and returns it rather than silently reporting stale "connected").
- `src/server.ts` — wired the folders router behind `requireApiKey`, with an injectable `FolderService` param (same DI pattern as M2's `ApiKeyRepository`) so tests don't need Prisma or Google credentials.
- Unit tests: `src/folders/folderService.test.ts` (in-memory fake repository + fake `DriveClient`) and `src/folders/foldersRouter.test.ts` (supertest against `createApp()` with fake services) — the latter's discriminated-union mock factories now explicitly typed (`vi.fn(async (): Promise<ConnectFolderResult> => ...)`), fixing the 4 typecheck errors left open at the previous checkpoint.

## Decisions

- **Same DI seam as M2.** `FolderService` is composed from injected `DriveClient` + `FolderRepository`, and `createApp()` takes an injectable `FolderService` — consistent with M2's `ApiKeyRepository` pattern, so unit tests never need a live DB or real Google credentials.
- **Drive's 404 ambiguity is treated as a single `not-found-or-not-shared` reason, not split further.** Drive API returns 404 both when a folder doesn't exist and when it exists but isn't shared with the service account — it deliberately doesn't leak existence to a caller without access. The `POST /folders` error message tells the user to share the folder either way, since that's the actionable step regardless of which case it is.
- **`POST /folders/:id/verify` returns `200` with an embedded `error`, not a `4xx`, when access has been revoked.** The request itself succeeded (we did verify, successfully, that the folder is no longer accessible) — collapsing that into a generic error status would make the client's job harder, not easier.

## Verified locally

This environment doesn't have Docker, so a throwaway local Postgres and Redis were used (Homebrew Postgres 18 binaries and Homebrew Redis, fresh data directories under `/tmp`, ports 5433/6380 — not the project's default 5432/6379 — so nothing collided with any real local services). Both were stopped and their data directories are scratch; nothing from them persists.

Against that instance:
1. `npx prisma migrate dev --name add_drive_folder` generated `prisma/migrations/20260806045227_add_drive_folder/` and regenerated the Prisma client.
2. `npm run lint`, `npm run typecheck`, `npm test` (38 tests passing, up from 27), `npm run build` all pass clean.
3. End-to-end smoke pass via a temporary script (not committed) that created a real account + API key through Prisma directly, wired `createApp()` with the real Prisma-backed `FolderService` but a stubbed `DriveClient` (no real GCP credentials wired into `.env` yet — tracked separately), and drove the HTTP API with `fetch`:
   - `POST /folders` with an "accessible" folder → `201`, persisted `DriveFolder` with `status: "CONNECTED"`.
   - `POST /folders` with an "inaccessible" folder → `422`, message includes "Share it with `drivesync@lens-and-sync.iam.gserviceaccount.com`".
   - `GET /folders` → `200`, scoped list containing the connected folder.
   - `POST /folders/:id/verify` while still accessible → `200`, status stays `CONNECTED`, `lastVerifiedAt` bumped.
   - `POST /folders/:id/verify` after access revoked → `200`, status flips to `NOT_ACCESSIBLE`, error message present in the same response.
   - `POST /folders/:id/verify` for an unknown ID → `404`.

CI will independently re-verify the migration applies cleanly via `prisma migrate deploy` against its own fresh Postgres service container on push.

## Explicitly not covered by this pass

- **Real Google Drive verification against the actual API.** `driveClient.ts` has never been exercised against a real service account / real folder — only through the fake `DriveClient` in unit tests and the smoke script. The service account JSON key exists (`lens-and-sync-26611f90cf98.json`, gitignored) but `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` in the local `.env` is currently misconfigured (a JSON-paste artifact, not the extracted PEM key — flagged separately, being fixed by the account owner directly since it involves the secret value). Real-API verification is tracked under the testing checklist's integration-test section, consistent with how M1/M2 also deferred real-credential passes.

## Next

M4 — Change detection: list folder contents, track file IDs + modified timestamps, detect new/updated/deleted, scoped per `DriveFolder`.
