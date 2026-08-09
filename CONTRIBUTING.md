# Contributing

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` (see comments in `.env.example`). You'll need a Postgres database and Redis instance — `docker-compose.yml` provides both, or point at your own.

```bash
npm run prisma:migrate
```

## Before opening a PR

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

All four must pass clean — CI runs the same four against fresh Postgres/Redis containers on every push and PR, so there's no way to skip this step without CI catching it anyway.

## Code style

- No comments explaining *what* code does — names should already make that clear. A comment is only worth adding when it explains a non-obvious *why*: a hidden constraint, a workaround, an invariant a future reader could easily violate by accident.
- Dependency injection over hardcoded imports. Every external system in this codebase (Prisma, the Drive API, OpenAI, Pinecone, Redis) sits behind an interface with a factory function (`createXClient(...)`), so business logic can be unit tested against a fake without touching the real thing. Follow this pattern for new external integrations.
- Fail closed, not silently. When something can't be determined (an unsupported file type, a scanned PDF with no text layer, a folder the service account can't access), return a specific, named failure reason — never silently return empty/default data that a caller might mistake for success.
- Prefer a pure function over a stateful service when the logic doesn't actually need persistence yet. Several pipeline stages (`detectChanges`, `chunkText`, `computeStaleVectorIds`) were built as pure functions well before the models that persist their inputs/outputs existed, and only wired to real state once that model landed. This kept each milestone testable in isolation without needing to build persistence prematurely.

## Adding a provider

The main contribution surface this project is built around. See [docs/adding-a-provider.md](docs/adding-a-provider.md) for the full walkthrough — in short:

1. Implement `EmbeddingProvider` (`src/embeddings/embeddingProvider.ts`) or `VectorStore` (`src/vectorstore/vectorStore.ts`).
2. Run the relevant contract test suite (`defineEmbeddingProviderContractTests` or `defineVectorStoreContractTests`) against your adapter — this is required, not optional, before a PR adding a new adapter will be merged. It's what catches an adapter that compiles but silently breaks a guarantee like namespace isolation.
3. Register it in the config-driven factory (`src/embeddings/index.ts` or `src/vectorstore/index.ts`) — one `case` added to a `switch`, no plugin-loading machinery.

## Reporting bugs / requesting features

Use the issue templates. For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Commit messages

No enforced convention, but a commit message should explain *why* a change was made, not just restate the diff.
