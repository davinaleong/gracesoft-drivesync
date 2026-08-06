# M2 — Own accounts & auth

Status: **Done**

## What was built

- `prisma/schema.prisma` — `Account`, `User`, `ApiKey` models. `ApiKey.hashedKey` is `@unique` so a presented key can be looked up by recomputing its hash and querying for equality, without ever storing (or being able to recover) the raw key.
- `prisma/migrations/20260806024554_init/` — initial migration, applied and verified against a real local Postgres before committing (see Verification below).
- `src/auth/apiKeyCrypto.ts` — `generateApiKey()` (random `dsk_`-prefixed key), `hashApiKey(rawKey, pepper)` (HMAC-SHA256), `looksLikeApiKey()` (cheap format check before touching the DB).
- `src/auth/apiKeyRepository.ts` — `ApiKeyRepository` interface (`findActiveByHashedKey`, `touchLastUsed`) plus a Prisma-backed implementation. Excludes revoked keys at the query layer.
- `src/middleware/requireApiKey.ts` — `createRequireApiKey(repository)` Express middleware factory. Missing header, malformed key, unknown key, and revoked key all return the identical `401 {"error":"unauthorized"}` — no signal leak about *why* a key was rejected.
- `src/server.ts` — wired the middleware onto a new `GET /me` route (returns the resolved account) as a concrete example of a protected endpoint; `createApp()` now takes an injectable `ApiKeyRepository` so tests don't need a live database.
- `src/lib/prisma.ts` — shared `PrismaClient` singleton.
- Admin CLI scripts (`scripts/create-account.ts`, `scripts/issue-api-key.ts`, `scripts/revoke-api-key.ts`), wired to `npm run account:create` / `api-key:issue` / `api-key:revoke`.
- CI and Dockerfile: Prisma generate/migrate steps added back in now that the schema has models.

## Decisions

- **No public account-signup endpoint.** Accounts are provisioned by the operator via CLI, not self-service HTTP. This service shares one Google service-account identity across all tenants (see M3) — an open signup endpoint would let anyone consume that shared Drive API quota. This matches the milestone checklist's framing of accounts as owned/operator-managed, not a public SaaS signup flow.
- **Same 401 shape for every rejection reason.** Directly implements the testing checklist's requirement that missing/malformed/revoked/unknown keys are indistinguishable from the outside.
- **HMAC-SHA256 with a lookup-by-hash-equality pattern**, not bcrypt/scrypt with per-record salt. API keys are high-entropy random values (32 bytes), not user-chosen passwords, so there's no offline brute-force risk that salting defends against — the standard pattern used by GitHub/Stripe-style PATs. This also keeps lookup O(1) via a unique index instead of requiring a full-table scan to try every stored salt.
- **`ApiKeyRepository` is an injected interface, not a direct Prisma call in the middleware.** The testing checklist lists API key auth/hashing as *unit* tests. Without this seam they'd require a live Postgres to test at all; with it, `requireApiKey.test.ts` runs against a fake in-memory repository.

## Verified locally

Since this environment doesn't have Docker, a throwaway local Postgres was initialized (via the Postgres binaries already installed under Laragon on this machine, into a fresh data directory in the session scratchpad — no existing user data touched) purely to generate and validate the initial migration and smoke-test the full flow end to end. It was stopped and the data directory deleted afterward; nothing from it persists.

Against that instance:
1. `prisma migrate dev --name init` generated `prisma/migrations/20260806024554_init/`.
2. `npm run account:create -- "Smoke Test Co"` created an account.
3. `npm run api-key:issue -- <accountId> "smoke-test-key"` issued a key.
4. Started the server, called `GET /me` with the issued key → `200` with the correct account; with no key → `401`; with a bogus key → `401`.
5. `npm run api-key:revoke -- <apiKeyId>`, then called `GET /me` with the now-revoked key → `401`.

Also: `npm run lint`, `npm run typecheck`, `npm test` (15 tests passing), `npm run build` all pass clean.

CI will independently re-verify the migration applies cleanly via `prisma migrate deploy` against its own fresh Postgres service container on push.

## Next

M3 — Drive folder connection (multi-tenant): `DriveFolder` model, `POST /folders` that verifies the service account can list the folder before saving.
