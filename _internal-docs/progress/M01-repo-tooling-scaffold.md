# M1 — Repo & tooling scaffold

Status: **Done**

## What was built

- `tsconfig.json` — strict TS config, `NodeNext` module resolution, `noUncheckedIndexedAccess` on.
- `tsconfig.build.json` — build-only variant that excludes `*.test.ts` from `dist/`.
- `eslint.config.js` — flat config (ESLint 9), typed linting for `src/**/*.ts`, untyped for root `*.config.ts` files (avoids pulling tooling configs into the `tsconfig.json` project graph).
- `vitest.config.ts` — node environment, v8 coverage, injects dummy env vars so `loadEnv()` doesn't need a real `.env` file to run tests.
- `Dockerfile` — multi-stage build (deps+build, then slim runtime). Prisma generate steps intentionally omitted until `prisma/schema.prisma` has models (starting M2).
- `docker-compose.yml` — Postgres 16 + Redis 7 with healthchecks, for local dev.
- `.github/workflows/ci.yml` — lint, typecheck, test, build on push/PR to `main`. Postgres+Redis service containers wired in but not yet used (no Prisma steps until M2).
- `prisma/schema.prisma` — datasource + generator only, no models yet.
- `src/config/env.ts` — zod-validated env loader (`loadEnv()`), fails fast with a readable list of missing/invalid vars instead of undefined-propagating through the app.
- `src/lib/logger.ts` — shared `pino` logger instance.
- `src/server.ts` — Express app factory (`createApp()`) + `/health` endpoint, entrypoint guarded so `import`-ing it in tests doesn't also start listening.
- `src/worker.ts` — placeholder entrypoint for `npm run worker`; real BullMQ wiring lands in M12.
- `src/server.test.ts` — smoke test for `/health` via `supertest`.

## Decisions

- **No Prisma generate/migrate in CI or Docker yet.** `prisma generate` refuses to run against a schema with zero models. Rather than add a throwaway placeholder model, the Prisma steps are deferred to M2 (`Account`/`User`), which is next anyway. CI and Dockerfile both have comments marking where those steps go back in.
- **`tsconfig.build.json` split from `tsconfig.json`.** Type-checking should cover test files; the compiled `dist/` output shouldn't contain them. Splitting avoids polluting the runtime image with `*.test.js`.
- **`import { pinoHttp }` (named import), not the default export.** `pino-http`'s CJS/ESM interop under `moduleResolution: NodeNext` makes the default import untyped as callable (a known DefinitelyTyped/NodeNext friction point); the named `pinoHttp` export sidesteps it cleanly.

## Verified locally

`npm install`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all pass clean. Docker/compose were not executed in this pass (no Docker daemon in this environment) — will be smoke-tested once there's an actual service worth containerizing (M2+).

## Next

M2 — Own accounts & auth (`Account`/`User` Prisma models, API key issuance/hashing/revocation, `requireApiKey` middleware). This will also be when Prisma generate/migrate steps get added back into CI and the Dockerfile.
