# GraceSoft DriveSync

[![CI](https://github.com/davinaleong/gracesoft-drivesync/actions/workflows/ci.yml/badge.svg)](https://github.com/davinaleong/gracesoft-drivesync/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-8a672a.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-20%2B-8a672a.svg)](package.json)

Syncs Google Drive folders into a vector store for retrieval-augmented generation (RAG), and exposes that index over a REST API and an [MCP](https://modelcontextprotocol.io) server. Multi-tenant from the ground up: each connected account gets its own API keys and its own isolated slice of the vector store — never another account's data, even on a shared index.

**📖 [Full documentation](docs/index.html)** — architecture, API reference, provider setup, and deployment in one page.

### At a glance

| | |
|---|---|
| **Does** | Drive folder → extraction → chunking → embeddings → vector store → REST/MCP retrieval |
| **Stack** | Node 20+/TypeScript · Postgres · Redis · BullMQ |
| **Pluggable modules attached** | Embeddings: **OpenAI** · Vector store: **Pinecone** (swap either — see [Adding a provider](docs/adding-a-provider.md)) |
| **Multi-tenant** | Per-account API keys; per-account vector namespace, never shared |
| **Processes** | `server` (REST), `worker` (scheduled sync), `mcp` (MCP tools) — one image, three start commands |
| **Build status** | 17/18 milestones complete — hosting on **Railway** ([deploy runbook](docs/deployment-runbook.md)); actual project not yet provisioned ([M18](_internal-docs/01-milestone-checklist.md)) |

## Features

- **Drive folder sync** — paste a folder ID, we verify a shared service account can see it, then keep it in sync on a schedule (BullMQ + Redis).
- **Extraction** — Google Docs, Sheets, Slides, and PDFs (with a text layer) to plain text.
- **Chunking** — token-budgeted chunks with overlap, using the same tokenizer (`tiktoken`'s `cl100k_base`) the reference embedding provider uses.
- **Pluggable providers** — `EmbeddingProvider` and `VectorStore` are interfaces, not hardcoded SDK calls. OpenAI and Pinecone ship as the reference adapters; see [Adding a provider](docs/adding-a-provider.md) to add your own.
- **Dedup & cleanup** — content-hash skip on unchanged files, stale-vector cleanup when a file is deleted or shrinks to fewer chunks.
- **Retrieval** — `POST /query` returns chunk text plus source attribution (file, section), not just IDs.
- **MCP tools** — `search` and `fetch_document`, scoped to the caller's account via the same API key used by the REST API.
- **Observability** — `GET /status` (per-folder sync health) and `GET /audit` (index totals), both scoped to the caller's account.

See [`_internal-docs/01-milestone-checklist.md`](_internal-docs/01-milestone-checklist.md) for the full build history and design decisions behind each piece.

## Architecture

```
Google Drive  →  extraction  →  chunking  →  EmbeddingProvider  →  VectorStore
  (M4 diff)       (M5)           (M6)          (M7, pluggable)      (M8, pluggable)
                                                                          │
                                                             REST /query ─┤
                                                             MCP search ──┘
```

A scheduled worker (BullMQ) iterates every connected folder across every account, with per-folder failure isolation (one broken folder doesn't stall others) and per-account rate limiting against the shared Drive service account's quota.

Three separate processes:

| Process | Entry point | Purpose |
|---|---|---|
| API server | `npm run dev` / `src/server.ts` | REST endpoints: folders, retrieval, status/audit |
| Sync worker | `npm run worker` / `src/worker.ts` | Scheduled Drive sync (BullMQ) |
| MCP server | `npm run mcp` / `src/mcp.ts` | MCP tools over streamable HTTP |

## Quickstart

Requires Node 20+, a Postgres database, and a Redis instance (`docker-compose.yml` provides both if you have Docker).

```bash
git clone https://github.com/davinaleong/gracesoft-drivesync.git
cd gracesoft-drivesync
npm install
cp .env.example .env
```

Fill in `.env` — see the comments in `.env.example` for what each variable is and where to get it (GCP service account, OpenAI key, Pinecone key). At minimum you need `DATABASE_URL`, `REDIS_URL`, `API_KEY_PEPPER`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `OPENAI_API_KEY`, and `PINECONE_API_KEY`.

```bash
docker compose up -d          # Postgres + Redis, if you don't have your own
npm run prisma:migrate        # create the schema
npm run account:create -- "My Company"
npm run api-key:issue -- <accountId> "first key"   # prints the raw key once — save it
```

Then, in separate terminals:

```bash
npm run dev      # REST API on PORT (default 3000)
npm run worker   # scheduled sync job
npm run mcp      # MCP server on MCP_SERVER_PORT (default 3001)
```

Connect a folder (share it with `GOOGLE_SERVICE_ACCOUNT_EMAIL` first):

```bash
curl -X POST http://localhost:3000/folders \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"folderId": "<google-drive-folder-id>"}'
```

The worker picks it up on the next scheduled run (`SYNC_CRON`, default every 15 minutes). Once synced:

```bash
curl -X POST http://localhost:3000/query \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"query": "what does this folder say about pricing?"}'
```

## Development

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

CI (`.github/workflows/ci.yml`) runs all four against fresh Postgres/Redis service containers on every push and PR.

## Docs

- **[Full documentation](docs/index.html)** — everything below, consolidated into one browsable page (architecture diagram, REST/MCP reference, env var table, provider setup, deployment). Open it directly in a browser.
- [Adding a provider](docs/adding-a-provider.md) — implement `EmbeddingProvider` or `VectorStore` for a different embedding API or vector database.
- [Architecture](docs/architecture.md) — the pipeline in more detail, and the design decisions behind the interface boundaries.
- [API reference](docs/api-reference.md) — REST endpoints and MCP tools.
- [Deployment runbook](docs/deployment-runbook.md) — process topology, required env vars, the OpenAI/Pinecone module setup (including the dimension-compatibility check to run before every deploy), migrations, and rollback.
- [Privacy Policy](docs/privacy.html) and [Terms & Conditions](docs/terms.html) — templates describing what this self-hosted software actually does with data; adapt before relying on them for a real deployment.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## License

[MIT](LICENSE)
