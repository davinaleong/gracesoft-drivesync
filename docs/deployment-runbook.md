# Deployment runbook

This is host-agnostic — no hosting provider has been chosen yet (see [M18](../_internal-docs/01-milestone-checklist.md)). It covers what's true regardless of where this runs: process topology, required env vars, the two currently-attached pluggable modules (OpenAI for embeddings, Pinecone for the vector store), migrations, and pre/post-deploy checks. Fill in the `<host-specific>` sections once a provider is picked.

## Process topology

One Docker image (see `Dockerfile`), three independently-run processes — not three images:

| Process | Compiled entry point | What it needs | Public? |
|---|---|---|---|
| API server | `node dist/server.js` | Postgres, Pinecone, OpenAI | Yes — REST clients |
| Sync worker | `node dist/worker.js` | Postgres, Redis, Google Drive, Pinecone, OpenAI | No |
| MCP server | `node dist/mcp.js` | Postgres, Pinecone, OpenAI | Yes — MCP clients |

The current `Dockerfile` only sets `CMD ["node", "dist/server.js"]`. Deploying the worker and MCP server means running the *same image* with an overridden start command — most PaaS providers (Railway, Render, Fly.io) support this natively as separate "services" sharing one build. There is no `docker-compose.yml` service for any of these three yet — the existing one only provisions local Postgres/Redis for development.

**Only one worker process should run per deployment right now.** See "Known gap: concurrent runs" below before scaling the worker horizontally.

## Prerequisites

Before touching a host, have these ready:

- [ ] A Postgres database reachable from wherever these processes run (managed or self-hosted — schema is plain Prisma/Postgres, nothing exotic).
- [ ] A Redis instance reachable from the worker (BullMQ's job queue).
- [ ] A GCP project with the Drive API enabled and a service account JSON key downloaded.
- [ ] An OpenAI API key.
- [ ] A Pinecone account, API key, and **an index created with the right dimension** — see the pluggable-modules section below before creating it.
- [ ] A domain, if this is going to be reachable at anything other than the host's default subdomain. `<host-specific: DNS records, TLS>`

## Environment variables

Every variable and its purpose is documented in `.env.example`; this section only calls out what matters operationally.

| Group | Vars | Notes |
|---|---|---|
| Core | `NODE_ENV`, `PORT`, `LOG_LEVEL` | Set `NODE_ENV=production`. `PORT` is only used by the API server. |
| Database & queue | `DATABASE_URL`, `REDIS_URL` | Fixed stack, not swappable — see `.env.example`. |
| Auth | `API_KEY_PEPPER` | Generate once (32+ random bytes), store as a secret. **Rotating it invalidates every issued API key** — treat it like a signing key, not a config value that gets casually regenerated. |
| Google Drive | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | The private key must keep its `\n` sequences literal, not converted to real newlines — most secret-manager UIs will do this correctly if you paste the JSON key's `private_key` field value directly, but double check after pasting (see the M3 progress doc for a real incident where this went wrong). |
| Embeddings module | `EMBEDDING_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL` | See below. |
| Vector store module | `VECTOR_STORE`, `PINECONE_API_KEY`, `PINECONE_INDEX_NAME` | See below. |
| Scheduling | `SYNC_CRON`, `DRIVE_RATE_LIMIT_PER_ACCOUNT` | Only read by the worker process. |
| MCP | `MCP_SERVER_PORT` | Only read by the MCP process. |

All required vars are validated at process startup (`src/config/env.ts`) — a missing or malformed one fails immediately with a specific error naming the variable, for every one of the three processes. There is no way to half-start with a bad config.

## Pluggable modules currently attached

`EmbeddingProvider` and `VectorStore` are interfaces, not hardcoded — see [Adding a provider](adding-a-provider.md). This deployment currently has OpenAI and Pinecone attached as those two modules. Each needs its own setup and, critically, **the two have to agree on a vector dimension** before the worker will sync anything.

### Embeddings module — OpenAI

- `EMBEDDING_PROVIDER=openai`
- `OPENAI_API_KEY` — from your OpenAI account.
- `OPENAI_EMBEDDING_MODEL` — defaults to `text-embedding-3-small` (1536 dimensions). Other supported models: `text-embedding-3-large` (3072) and `text-embedding-ada-002` (1536). The dimension is looked up from a fixed table in code (`src/embeddings/openaiEmbeddingProvider.ts`) — an unrecognized model name fails at startup rather than guessing.

### Vector store module — Pinecone

- `VECTOR_STORE=pinecone`
- `PINECONE_API_KEY` — from your Pinecone account.
- `PINECONE_INDEX_NAME` — an index that **must already exist**, created with a dimension matching the embeddings module's output (see next section). This project's code never creates a Pinecone index for you.

### Dimension compatibility — check this before every deploy that touches either module

Embedding dimension is fixed per model and baked into a Pinecone index at creation time. There is no partial or live migration path between mismatched dimensions (see [M9](../_internal-docs/progress/M09-provider-swap-behavior.md)). `assertEmbeddingDimensionMatchesVectorStore` enforces this at the start of every sync run and fails the whole run closed on a mismatch — which is a safety net, not a substitute for checking before you deploy.

**Concrete incident, found while testing this project**: a real deployment had `OPENAI_EMBEDDING_MODEL=text-embedding-3-small` (1536 dimensions) configured against a Pinecone index that had been created with dimension 512. Every scheduled sync run failed immediately with a clear error — correctly, per M9's design — but that also means **zero syncing happens until it's fixed**. Before deploying:

1. Know your embedding model's dimension (1536 for `text-embedding-3-small`/`text-embedding-ada-002`, 3072 for `text-embedding-3-large`).
2. Check the target Pinecone index's dimension (Pinecone console, or `describeIndexStats()`).
3. If they don't match: either create a new index with the correct dimension and point `PINECONE_INDEX_NAME` at it, or change `OPENAI_EMBEDDING_MODEL` to one that matches the existing index — not both casually, and never on a deployment with existing synced data without planning a full resync first.

### Swapping either module later

Both are contribution points, not permanent choices — see [Adding a provider](adding-a-provider.md) for implementing a different `EmbeddingProvider` or `VectorStore`. Swapping on a deployment with existing data always means a full resync (delete and recreate the vector index, let the worker resync every connected folder from scratch) — there's no in-place migration, by design.

## Database migrations

```bash
npm run prisma:deploy   # `prisma migrate deploy` — applies pending migrations, does not generate new ones
```

Run this once per deploy, before starting (or restarting) any of the three processes, against the target environment's `DATABASE_URL`. This is what CI already runs against a fresh database on every push (`.github/workflows/ci.yml`) — the same command, just pointed at a real environment instead of a CI service container.

Never run `prisma migrate dev` (which can generate *and* apply schema changes) against staging or production — `dev` is a local-development command that assumes an ephemeral, disposable database.

## Staging vs. production

Two fully separate environments — separate `DATABASE_URL`, separate Redis instance, and **separate Pinecone index/namespace root** (namespaces are per-account inside one index, but staging and production sharing an index would mean a staging account and a production account could theoretically collide). Reasonable options:

- Two Pinecone indexes (`drivesync-staging`, `drivesync`), one per environment.
- A separate GCP service account per environment is optional but reduces blast radius if a staging key leaks.

`<host-specific: how the provider names/isolates environments — e.g. Railway environments, Fly.io apps, separate Render services>`

## Deploy steps

1. Build the image (`docker build .`, or the host's native build step from this repo).
2. `<host-specific: push image / trigger build>`
3. Run `npm run prisma:deploy` against the target database (as a one-off job/task, not baked into the image's default `CMD`, so migrations run exactly once per deploy, not once per process replica).
4. Start/restart the API server process.
5. Start/restart the worker process. It re-registers its repeatable BullMQ job on every start using a fixed `jobId` (`scheduled-sync`) — restarting is idempotent, it won't accumulate duplicate schedules.
6. Start/restart the MCP server process.
7. `<host-specific: health check / readiness probe config — GET /health on the API server is unauthenticated and safe to use as a liveness check; there is no equivalent unauthenticated endpoint on the worker or MCP server, since they have nothing to serve without an account context>`

## Post-deploy smoke test

Run these against the deployed environment, using a real issued API key:

```bash
curl https://<api-host>/health
# {"status":"ok"}

curl https://<api-host>/me -H "Authorization: Bearer <key>"
# {"account": {...}}

curl https://<api-host>/status -H "Authorization: Bearer <key>"
# {"folders": [...]}  — empty array is fine on a fresh deploy
```

If any connected folders exist, watch `GET /status` after the next scheduled sync interval (`SYNC_CRON`) and confirm `lastSyncStatus` moves to `SUCCESS` — this is the single most direct way to confirm embeddings + vector store + Drive credentials are all correctly wired in the new environment, since a dimension mismatch, a bad API key, or a broken service account key will all surface here as `FAILED` with `lastSyncError` populated.

## Rollback

- **App code**: redeploy the previous image tag. Stateless — no in-memory state to worry about losing.
- **Database migrations**: Prisma migrations are forward-only by default (no auto-generated down migration). Roll back by writing and applying a new migration that reverses the change, not by trying to "undo" the applied one. Test this in staging first, always.
- **A bad provider swap** (wrong dimension, wrong index): see the dimension-compatibility section above — the fix is pointing config back at a compatible index/model, not a code rollback.

## Known gap: concurrent sync runs

Flagged in [M17](../_internal-docs/progress/M17-testing-and-ci.md): a single worker process never runs two sync jobs at once (BullMQ's default concurrency), and BullMQ's own per-job lock stops the *same* scheduled job being double-processed if you do run multiple worker processes — but there is **no cross-process lock** preventing two *different* jobs (a scheduled tick and a manually-triggered one, on two separate worker processes) from both processing the same folder concurrently. Run exactly one worker process per environment until this is closed; do not horizontally scale the worker without adding a per-folder lock first.
