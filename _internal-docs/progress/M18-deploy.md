# M18 — Deploy

Status: **Partially done — hosting decided (Railway), instructions given, environment not yet provisioned**

## What was built

- `docs/deployment-runbook.md` — a host-agnostic deployment runbook:
  - **Process topology**: one Docker image, three independently-run processes (`server`, `worker`, `mcp`), with the current `Dockerfile` gap called out explicitly (it only defines `CMD` for the API server — the worker and MCP processes need the same image with an overridden start command, which is how most PaaS providers model multi-service deploys from one build).
  - **Environment variables**, grouped by purpose, with operational notes beyond what `.env.example`'s inline comments already say (e.g. the private key's literal-`\n` gotcha, referencing the real M3 incident where that went wrong).
  - **The two currently-attached pluggable modules** (OpenAI for `EmbeddingProvider`, Pinecone for `VectorStore`) as their own section, per the user's explicit request to frame the runbook around them — including a dimension-compatibility pre-flight check, written up using the *real* mismatch discovered live in M17 (a real deployment's `text-embedding-3-small`, 1536 dimensions, against a real Pinecone index created at 512) as the concrete cautionary example, not a hypothetical.
  - **Migrations** (`prisma migrate deploy`, explicitly *not* `migrate dev`, against a real environment).
  - **Staging vs. production separation**, post-deploy smoke test steps (reusing the same commands already verified live in M16/M17), and a rollback plan.
  - **The concurrent-sync-runs gap** from M17, restated as an operational constraint ("run exactly one worker process") rather than left as an abstract testing-checklist note.
  - **Railway setup** (added after the user asked specifically): concrete steps for a 3-service, 1-project Railway deployment — service creation, Custom Start Commands, variable wiring via plugin references and Shared Variables, the `MCP_SERVER_PORT`/Networking-target-port gotcha, and using `railway run` for one-off migrations.
- `docs/index.html` — deployment section updated to name Railway as the chosen host.
- `README.md` — linked the new runbook from the docs section.

## Decisions

- **Initially, no hosting provider was chosen** — offered the user a choice (runbook-only / pick-a-host-then-you-provision / skip) rather than guessing, and wrote the runbook provider-agnostic with `<host-specific>` placeholders. **The user then asked for Railway specifically** (matching v1's choice), so those placeholders were replaced with a concrete "Railway setup" section: one project, three services (`api`/`worker`/`mcp`) sharing one Dockerfile build via per-service Custom Start Commands, managed Postgres/Redis plugins, Shared Variables to avoid re-entering secrets per service, and Railway's built-in Environments feature for staging/production separation.
- **Instructions were given to the user to execute themselves, not performed directly.** Creating a Railway project, adding billing-relevant plugins, setting real secrets, and triggering a real deploy all require the user's account access and billing consent — none of which are mine to act on. What I could and did do: give complete, concrete, copy-pasteable instructions (in chat and now in the runbook), and identify the two Railway-specific gotchas that would otherwise cause real confusion — (1) the `mcp` service's `MCP_SERVER_PORT` doesn't match Railway's automatic `PORT`-env convention, so its Networking target port needs an explicit override; (2) migrations should run as a one-off `railway run` command, not chained into a service's start command, to avoid re-running per replica.
- **The dimension-compatibility section still uses the real incident from M17, not a fabricated example.** Unaffected by the hosting decision — it's about the OpenAI/Pinecone module pairing, not where the process runs.

## Explicitly not done

- No Railway project has actually been created — the account, billing, and plugin provisioning are the user's to do, following the instructions given.
- Domain/DNS beyond Railway's default `*.up.railway.app` subdomains is not set up (the runbook notes this is optional and TLS is automatic either way).
- The `Dockerfile`/`docker-compose.yml` still don't define the worker or MCP processes as runnable services in *code* — Railway's Custom Start Command setting overrides this per-service without needing a Dockerfile change, so this was a documentation gap, not a blocking one, and is now resolved in the runbook rather than in `Dockerfile` itself.

## Next

None — this was the last milestone on the checklist. Remaining work (actually creating the Railway project and running the deploy, closing the concurrent-sync-runs gap if the worker needs to scale beyond one replica) is tracked here and in the runbook rather than deferred silently.
