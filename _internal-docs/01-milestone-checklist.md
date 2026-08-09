# GraceSoft DriveSync — v2 Milestone Checklist

Ground-up rebuild in its own repo. `lens-and-sync` (specifically `apps/drive-sync` in the old monorepo) is treated as exploratory/reference only — nothing is ported wholesale, but every v1 feature is accounted for below so nothing gets dropped by accident.

## Stack decision

Stays Node/TypeScript (Express, Prisma, Postgres, Redis, BullMQ, googleapis) — same stack as v1, now standalone with its own DB and its own auth (no more borrowing DishLens's JWT). Pinecone and OpenAI move from hard dependencies to default reference adapters behind `VectorStore`/`EmbeddingProvider` interfaces (see M7/M8) — core stack (Postgres/Redis/BullMQ) stays fixed, but the embedding and vector-store choices are contributor-swappable.

## Milestones

Carries forward the Drive→Pinecone pipeline (v1 milestones 1–11, reference `_internal-docs/02-milestones-checklist.md` in the old repo), rebuilt as its own service with real multi-tenancy and its own auth from day one.

- [x] **M1. Repo & tooling scaffold** — new repo, `package.json`, TS config, eslint, vitest, Dockerfile, docker-compose (Postgres + Redis), GitHub Actions CI. No Turbo/pnpm-workspace — single app. See `_internal-docs/progress/M01-repo-tooling-scaffold.md`.
- [x] **M2. Own accounts & auth** — `Account`/`User` model + API key issuance, hashing, and revocation; `requireApiKey` middleware. Replaces v1's borrowed-JWT trust entirely — this service verifies nothing it didn't issue itself. See `_internal-docs/progress/M02-accounts-auth.md`.
- [x] **M3. Drive folder connection (multi-tenant)** — `DriveFolder` model (`accountId`, `folderId`, `connectedAt`, `lastVerifiedAt`, `status`); `POST /folders` takes a user-pasted folder ID, verifies the published service-account email can list it before saving; clear failure messaging when sharing hasn't happened yet. See `_internal-docs/progress/M03-drive-folder-connection.md`.
- [x] **M4. Change detection** — list folder contents, track file IDs + modified timestamps, detect new/updated/deleted — ported from v1, now scoped per `DriveFolder` instead of one global list. See `_internal-docs/progress/M04-change-detection.md`.
- [x] **M5. Extraction pipeline** — Docs/Sheets/PDFs/Slides → plain text. Ported from v1. Scanned-PDF OCR decided as an explicit fast-follow, not v2-launch scope (fails closed with `scanned-pdf-ocr-not-implemented` instead of silently returning nothing). See `_internal-docs/progress/M05-extraction-pipeline.md`.
- [x] **M6. Chunking** — token-budgeted chunks with overlap, section/heading metadata preserved. Ported from v1. See `_internal-docs/progress/M06-chunking.md`.
- [x] **M7. Embeddings** — define an `EmbeddingProvider` interface (`embed(texts): Promise<number[][]>`, `dimensions`) so the pipeline never talks to a specific embeddings API directly; ship an OpenAI `text-embedding-3-small` adapter as the reference implementation, batched with retry/backoff. Interface is the deliverable, OpenAI adapter is one implementation of it — this is what makes embeddings swappable for contributors. See `_internal-docs/progress/M07-embeddings.md`.
- [x] **M8. Vector store writes** — define a `VectorStore` interface (`upsert`, `query`, `delete`, all namespace-scoped) so the pipeline never talks to a specific vector DB directly; ship a Pinecone adapter as the reference implementation, **per-account namespace** instead of one shared namespace, stable `{fileId}-{chunkIndex}` vector IDs. Provider selection is config-driven (e.g. `VECTOR_STORE=pinecone`) via a small registry — no dynamic plugin loading needed, just a map a contributor adds a line to. See `_internal-docs/progress/M08-vector-store-writes.md`.
- [x] **M9. Provider swap behavior** — document (and confirm in code) that switching `EmbeddingProvider` on an existing deployment requires a full resync: embedding dimension is fixed per provider and baked into the vector store index/collection at creation time, so there's no partial/live migration path between providers with different dimensions. See `_internal-docs/progress/M09-provider-swap-behavior.md`.
- [x] **M10. Dedup & versioning** — content-hash skip on unchanged files, stale-vector cleanup on delete. Ported from v1. See `_internal-docs/progress/M10-dedup-versioning.md`.
- [x] **M11. Sync state persistence** — `DriveFile` model, scoped per account/folder. Ported from v1's Postgres/Prisma layer. See `_internal-docs/progress/M11-sync-state-persistence.md`.
- [ ] **M12. Scheduling** — BullMQ + Redis, job now iterates every connected folder across every account, with per-folder failure isolation (one broken folder doesn't stall others) and per-account rate limiting against the shared service account's Drive quota.
- [ ] **M13. Retrieval endpoint** — query API returning top-k chunks. Unlike v1, **returns chunk text plus attribution**, not metadata-only — needed for actual AI consumption. Scoped strictly to the caller's own namespace.
- [ ] **M14. MCP server exposure** — wrap retrieval + document fetch as MCP tools so any MCP-compatible client (not just DishLens) can search a connected folder. New in v2, aimed at the open-source pitch.
- [ ] **M15. Observability** — structured sync logs, failure alerts, `/status` and `/audit` endpoints. Ported from v1.
- [ ] **M16. Open-source readiness** — README for external users, LICENSE confirmed, CONTRIBUTING + issue templates, scrubbed `.env.example`, security disclosure policy, docs site (v1's `docs/` is a reasonable starting point). Include an "Adding a provider" guide walking through implementing `EmbeddingProvider`/`VectorStore` and registering a new adapter, since that's the main contribution surface this project is designed around.
- [ ] **M17. Testing & CI** — unit + integration coverage, full lint/typecheck/test/build pipeline (v1 had two latent CI bugs — strict Turbo env stripping and an uninstalled eslint — worth a clean-room check that this doesn't recur).
- [ ] **M18. Deploy** — staging + production environment, migration runbook, domain/DNS. (Hosting target not yet decided for this service — v1 ran on Railway; revisit separately from DishLens's Laravel Cloud choice, since they don't need to match.)

**Explicitly deferred**: per-user Google OAuth + Picker as an alternative folder-connection method (documented as a future option in the restructuring plan, not v2 scope).

**Non-goals carried over from v1**: GraphQL remains out of scope.