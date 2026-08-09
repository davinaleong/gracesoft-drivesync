# M18 — Deploy

Status: **Partially done — migration runbook written, environment/DNS not started**

## What was built

- `docs/deployment-runbook.md` — a host-agnostic deployment runbook:
  - **Process topology**: one Docker image, three independently-run processes (`server`, `worker`, `mcp`), with the current `Dockerfile` gap called out explicitly (it only defines `CMD` for the API server — the worker and MCP processes need the same image with an overridden start command, which is how most PaaS providers model multi-service deploys from one build).
  - **Environment variables**, grouped by purpose, with operational notes beyond what `.env.example`'s inline comments already say (e.g. the private key's literal-`\n` gotcha, referencing the real M3 incident where that went wrong).
  - **The two currently-attached pluggable modules** (OpenAI for `EmbeddingProvider`, Pinecone for `VectorStore`) as their own section, per the user's explicit request to frame the runbook around them — including a dimension-compatibility pre-flight check, written up using the *real* mismatch discovered live in M17 (a real deployment's `text-embedding-3-small`, 1536 dimensions, against a real Pinecone index created at 512) as the concrete cautionary example, not a hypothetical.
  - **Migrations** (`prisma migrate deploy`, explicitly *not* `migrate dev`, against a real environment).
  - **Staging vs. production separation**, post-deploy smoke test steps (reusing the same commands already verified live in M16/M17), and a rollback plan.
  - **The concurrent-sync-runs gap** from M17, restated as an operational constraint ("run exactly one worker process") rather than left as an abstract testing-checklist note.
- `README.md` — linked the new runbook from the docs section.

## Decisions

- **No hosting provider was chosen, and no real infrastructure was provisioned.** The milestone's own text flags this explicitly ("hosting target not yet decided"), and picking one, registering a domain, and provisioning real staging/production environments all require the user's account access, billing, and domain ownership — none of which are mine to act on. Offered the user a choice (runbook-only / pick-a-host-then-you-provision / skip) rather than guessing; the user asked specifically for the runbook, framed around the OpenAI/Pinecone modules.
- **The runbook is written to be provider-agnostic with explicit `<host-specific>` placeholders**, rather than guessing a provider and writing host-specific instructions that would need rewriting the moment a real host is chosen. Every piece that *is* host-independent (process topology, env vars, the module dimension check, migrations, rollback) is fully concrete now; only the genuinely host-dependent pieces (build/push mechanics, environment isolation mechanics, DNS/TLS) are left as fill-in points.
- **The dimension-compatibility section uses the real incident from M17, not a fabricated example.** It's more convincing and more directly useful than an invented scenario, and it's true.

## Explicitly not done

- Staging and production environments are not provisioned anywhere.
- Domain/DNS is not set up.
- The `Dockerfile`/`docker-compose.yml` don't yet define the worker or MCP processes as runnable services — the runbook documents the gap and the workaround (override `CMD` on the same image) but doesn't close it with actual config, since that's tied to whichever host is eventually chosen.

## Next

None — this was the last milestone on the checklist. Remaining work (hosting decision, environment provisioning, DNS, closing the concurrent-sync-runs gap if the worker needs to scale) is tracked here and in the runbook rather than deferred silently.
