# M18 addendum — Prisma/OpenSSL crash on Railway

Status: **Fix applied locally, not yet verified against a real Railway redeploy**

## What prompted this

The user provisioned the Railway project themselves (per the M18 runbook) and
triggered a real deploy. The `server` service started (`server listening` on
port 8080) but every Prisma-backed request crashed with:

```
prisma:warn Prisma failed to detect the libssl/openssl version to use, and
may not work as expected. Defaulting to "openssl-1.1.x".
...
PrismaClientInitializationError: Unable to require
(`/app/node_modules/.prisma/client/libquery_engine-debian-openssl-1.1.x.so.node`).
Prisma cannot find the required `libssl` system library in your system.
Details: libssl.so.1.1: cannot open shared object file: No such file or directory
```

Root cause: `Dockerfile`'s base image, `node:20-slim`, is Debian 12
(bookworm), which ships with **no OpenSSL libraries installed at all** —
neither 1.1 nor 3.x. `npm run prisma:generate` runs inside the image during
the Docker build; unable to detect any `libssl` on the machine building it,
Prisma silently fell back to generating the `debian-openssl-1.1.x` engine
binary. That binary can't load at container start either, since the running
image has the same absence of `libssl`. This crash also explains the
`folderCount: 0` symptom investigated earlier in the same session — separate
issue, but worth noting: with the DB layer crashing, even a successfully
`POST /folders`-connected local dev database looked unrelated to the actual
Railway 500s.

## What was built

- `Dockerfile` — added `RUN apt-get update -y && apt-get install -y openssl
  && rm -rf /var/lib/apt/lists/*` to both the `base` and `runtime` stages,
  before their respective `RUN npm run prisma:generate` steps. This makes
  the build-time `prisma generate` correctly detect Debian bookworm's real
  OpenSSL (3.x) and generate the matching `debian-openssl-3.0.x` engine
  binary, and ensures that same `libssl` is present at runtime for it to
  load.

## Decisions

- **Installed `openssl` via `apt-get` rather than pinning `binaryTargets` in
  `schema.prisma`.** `schema.prisma` has no `binaryTargets` override today —
  Prisma auto-detects the target from the machine running `generate`. Adding
  a hardcoded `binaryTargets = ["debian-openssl-3.0.x"]` would work too, but
  it hardcodes a Debian-version assumption into the schema for every
  contributor, whereas installing `openssl` fixes the actual missing
  dependency and lets Prisma's existing auto-detection keep working as
  designed — matches the M16 goal of the schema staying portable for
  contributors on different base images.
- **Installed in both Docker stages, not just `runtime`.** The `base` stage
  also runs `prisma:generate` (for `npm run build`'s typecheck against the
  generated client) and would otherwise still emit the build-time warning
  and generate the wrong engine target during that stage, even though only
  `runtime`'s copy is what actually ships.

## Verified locally

- No Docker daemon available in this environment to run a real
  `docker build`, so the fix has **not** been built-and-run locally.
  `npm run typecheck`/`lint`/`test` are unaffected (they don't touch the
  Dockerfile) and continue to pass.

## Explicitly not done

- Not yet verified against a real Railway redeploy. The user needs to push
  this commit (triggering Railway's auto-deploy, or run a manual redeploy)
  and confirm the `server`/`worker`/`mcp` services start clean and a real
  `POST /folders` call succeeds against the production database.

## Next

Once the user confirms a clean Railway redeploy: retry `POST /folders`
against the deployed (or local) API with a folder actually shared with
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, confirm a `DriveFolder` row is created, then
re-run the worker and confirm the per-file sync logs (from the earlier fix
in `_internal-docs/progress/M15-observability-addendum-file-level-logs.md`)
show real added/updated/skipped output.
