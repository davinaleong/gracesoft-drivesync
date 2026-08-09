# M10 — Dedup & versioning

Status: **Done**

## What was built

- `src/dedup/contentHash.ts`:
  - `computeContentHash(text)` — SHA-256 of the extracted text (post-M5), hex-encoded.
  - `hasContentChanged(previousHash, currentHash)` — `true` when there's no previous hash (never synced before) or the hashes differ.
- `src/dedup/vectorIds.ts`:
  - `buildVectorId(fileId, chunkIndex)` — the stable `{fileId}-{chunkIndex}` scheme referenced in M8's milestone description.
  - `computeStaleVectorIds(fileId, previousChunkCount, currentChunkCount)` — the trailing chunk IDs that no longer correspond to any current chunk. One function covers both stale-vector scenarios: a fully deleted file (`currentChunkCount = 0` → every previous chunk ID is stale) and a modified file that now chunks into *fewer* pieces than before (the old trailing indices are orphaned even though the file still exists and wasn't deleted).
- `src/dedup/contentHash.test.ts` and `src/dedup/vectorIds.test.ts` — deterministic hashing, whitespace sensitivity, the changed/unchanged decision, and every chunk-count transition (unchanged/grown/shrunk/deleted/brand-new) for stale-ID computation.

## Decisions

- **Content hash is computed over extracted text, not raw Drive bytes.** Drive's `modifiedTime` (M4's cheap change signal) can change without the actual content changing — a re-save with no edits, or a metadata-only touch. Hashing raw bytes would catch this too, but there's no single "raw bytes" representation across the file types M5 handles (Google-native files are exported, not downloaded — there's nothing to hash before extraction runs). Hashing post-extraction text is the one representation that's uniform across Docs/Sheets/Slides/PDFs, at the cost of still paying the extraction cost even for a file whose content-hash turns out unchanged (only the more expensive chunk+embed+upsert steps get skipped). Worth revisiting if extraction cost itself becomes the bottleneck.
- **The "shrunk-file" stale-vector case is the one worth calling out.** It's easy to wire "delete a file → clean up its vectors" and stop there, but a file that's *modified* and re-chunks into fewer pieces than its previous version leaves orphaned vectors behind just as surely as a full delete does — those stale chunks would keep showing up in retrieval results forever if nothing computes and removes them. `computeStaleVectorIds` treats both as the same underlying operation (previous count → current count, where current may be zero) specifically so this case can't be forgotten when M12 wires sync runs together.
- **Neither module is wired into a running sync process yet.** Both need per-file state from `DriveFile` (the previous content hash, the previous chunk count) that doesn't persist anywhere until M11. Same "logic now, wiring later" split as M4's `detectChanges`, M6's `chunkText`, and M9's `assertEmbeddingDimensionMatchesVectorStore` — this is now the fourth pipeline stage built this way, all converging on M12's sync job as the place they finally get composed together against real persisted state.

## Verified locally

`npm run lint`, `npm run typecheck`, `npm test` (97 tests passing, up from 83), `npm run build` all pass clean. No database needed — both modules are pure functions.

## Next

M11 — Sync state persistence: `DriveFile` model, scoped per account/folder. This is where M4's `detectChanges`, M9's `assertEmbeddingDimensionMatchesVectorStore`, and M10's `contentHash`/`vectorIds` all finally get real state to read from and write to.
