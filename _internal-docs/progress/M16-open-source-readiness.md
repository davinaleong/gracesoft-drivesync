# M16 — Open-source readiness

Status: **Done**

## What was built

- `README.md` — rewritten from a two-line placeholder: features, an ASCII architecture diagram, the three-process model (API server / worker / MCP server) and their entry points, a full quickstart (clone → install → configure → migrate → provision an account and key → run all three processes → connect a folder → query it), dev commands, and links to the new docs.
- `CONTRIBUTING.md` — dev setup, the four checks required before a PR (lint/typecheck/test/build, matching CI exactly), code-style conventions actually followed in this codebase (DI over hardcoded imports, fail closed not silently, pure functions before persistence exists), and a summary of the "adding a provider" contribution path linking to the detailed guide.
- `SECURITY.md` — vulnerability reporting via GitHub's private Security Advisories feature (per the user's explicit choice — no fabricated contact email), plus a scope note distinguishing this project's code from a specific deployment's operational security.
- `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md`.
- `docs/adding-a-provider.md` — the guide the milestone explicitly calls for: step-by-step for both `EmbeddingProvider` and `VectorStore`, referencing the actual reference adapters (`openaiEmbeddingProvider.ts`, `pineconeVectorStore.ts`) as the pattern to follow, and stating plainly that passing the relevant contract test suite is required, not optional, before a new-adapter PR merges — with the specific failure mode (namespace isolation silently breaking) that requirement exists to catch.
- `docs/architecture.md` — the pipeline stages in narrative form with links to each milestone's progress doc, the multi-tenancy/namespace model, and the DI pattern used throughout.
- `docs/api-reference.md` — every REST endpoint and both MCP tools, with real request/response shapes taken directly from the router code (not approximated).
- `LICENSE` — already present (MIT, correct copyright), confirmed rather than rewritten.

## Decisions

- **`docs/` is a set of Markdown files, not a generated static site.** The milestone's own wording ("v1's `docs/` is a reasonable starting point") doesn't mandate a docs *site* (Docusaurus, VitePress, etc.) — introducing a static site generator and its build/deploy pipeline for three pages would be real infrastructure for a need that isn't established yet. Markdown in `docs/`, linked from the README, is the same content at a fraction of the setup cost; a generated site is a reasonable future addition if the docs outgrow this.
- **Security contact is GitHub Security Advisories only, not an email address.** The user's explicit choice, made when asked directly rather than assumed — fabricating a plausible-looking security contact email would have been actively misleading, not just under-specified.
- **The "Adding a provider" guide states the contract suite requirement as mandatory, matching how it's actually enforced (by convention/review, not a CI gate yet).** Worth flagging: nothing currently *forces* a new adapter PR to include the contract suite — it's a documented expectation, not a lint rule or CI check. If contributions pick up, wiring an actual enforcement (a CI job that fails if a new file under `src/embeddings/` or `src/vectorstore/` doesn't import `defineEmbeddingProviderContractTests`/`defineVectorStoreContractTests`) would be a reasonable fast-follow.

## Verified locally

- `npm run lint`, `npm run typecheck`, `npm test` (150 tests, unchanged — this milestone is documentation-only, no source changes), `npm run build` all pass clean.
- **Every command in the README's Quickstart was actually run**, not just written and assumed correct: `npx prisma migrate dev` (against a fresh throwaway Postgres), `npm run account:create -- "My Company"`, `npm run api-key:issue -- <accountId> "first key"`, starting the real server, and the documented `POST /folders` curl example plus `/me`, `/status`, `/audit` — all returned exactly what the README and `docs/api-reference.md` say they return.
- **CI history independently confirms the "clean checkout" claim**: `gh run list` shows every push to `main` since M3 has passed CI (lint, typecheck, Prisma generate/deploy, test, build) against fresh GitHub-hosted Postgres/Redis service containers — real evidence from a real, independent environment, not just this machine.

## Explicitly not covered by this pass

- **No literal `git clone` into a brand-new directory was performed** — verification reused this working copy (dependencies already installed) rather than a byte-for-byte fresh contributor experience. The commands themselves were run for real, but `npm install`'s own correctness on a totally clean checkout is only indirectly covered (by CI's `npm ci` succeeding on every push).
- **The "Adding a provider" guide's steps haven't been followed by an actual second implementation.** It's written correctly against the real interfaces and existing adapters, but nobody has yet built a third `EmbeddingProvider`/`VectorStore` adapter using it as the only instructions, which would be the strongest possible verification.

## Next

M17 — Testing & CI: unit + integration coverage, full lint/typecheck/test/build pipeline, clean-room CI check (much of this is already true in practice — see this milestone's CI-history verification above — M17's job is to confirm that's real coverage, not coincidence, and close any remaining gaps).
