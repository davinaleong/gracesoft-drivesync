# M6 — Chunking

Status: **Done**

## What was built

- `src/chunking/chunkText.ts`:
  - `Tokenizer` interface (`encode`/`decode`) and `createTiktokenTokenizer()` — a real implementation using `js-tiktoken`'s `cl100k_base` encoding, the same encoding OpenAI's `text-embedding-3-small` uses (M7's reference `EmbeddingProvider`), so token counts measured here are the counts that provider will actually see.
  - `chunkText(text, tokenizer, options)` — splits text into token-budgeted chunks (`maxTokens`) with overlap (`overlapTokens`), returning `{ index, text, section, tokenCount }[]`.
  - Section/heading detection (`segmentBySection`, internal): splits on blank-line-separated paragraphs, treats a paragraph as a heading if it's a single short (`<=80` char) line with no trailing sentence punctuation and is either Markdown-style (`#`/`##`/etc.) or Title Case / ALL CAPS. Tracks the "current heading" while walking paragraphs and attaches it to every chunk produced from the body text that follows, until the next heading.
  - Overlap is applied within a segment only — it never crosses a section boundary, so a chunk's attached `section` metadata is never contaminated by content from a different section.
  - Input validation: throws if `maxTokens <= 0` or `overlapTokens` isn't strictly smaller than `maxTokens` (an overlap `>=` the chunk size would prevent the sliding window from making progress).
- `src/chunking/chunkText.test.ts` — 12 tests: single-chunk passthrough, empty-text edge case, multi-chunk splitting with exact overlap verification, section attribution (plain and Markdown-style), section-less body text, overlap-doesn't-cross-boundary, invalid-options rejection, and two tests against the real `createTiktokenTokenizer()` (round-trip correctness, and end-to-end token-count respecting `maxTokens`) rather than only the deterministic fake tokenizer used for the boundary-logic tests.
- Added `js-tiktoken@1.0.21` as a dependency.

## Decisions

- **Heading detection deliberately favors precision over recall.** The first version of this heuristic (any short line without trailing punctuation) was too permissive — it misclassified ordinary lowercase sentences like "one two three" as headings, which silently dropped that content from any chunk (an empty-looking body segment produces zero chunks). Caught by a test that used a plain word list as input and got `0` chunks back instead of `1`. Tightened to require Title Case, ALL CAPS, or an explicit Markdown `#` prefix. The asymmetry matters: a missed heading just means a section goes untracked (degraded, still correct), but a false-positive heading means real content silently vanishes (a correctness bug) — so the heuristic is tuned to fail toward the former.
- **Still a heuristic, not a structural analysis — flagged, not solved.** Plain-text export (M5) loses real heading styling entirely. This is the same "flag rather than gold-plate" treatment already applied to M5's Sheets-multi-sheet and scanned-PDF-OCR gaps. A future fast-follow could export Docs as HTML instead of plain text and parse real heading tags, at the cost of a heavier extraction step.
- **`chunkText` doesn't attach `fileId`/`title`/chunk-global-uniqueness metadata itself.** Those require a `DriveFile` identity, which doesn't exist as a concrete model until M11. `chunkText` is a pure function over a string; the caller (a future sync job) is responsible for combining its output with file identity once that model exists — same "interface/logic now, persistence-dependent wiring later" split used for M4's `detectChanges`.
- **Tokenizer is injected, not hardcoded to `js-tiktoken` inside `chunkText`.** Consistent with every other seam in this codebase (`DriveClient`, `PdfParser`, `FolderRepository`) — lets the chunk-boundary logic be tested deterministically (word-level fake tokenizer) independent of tiktoken's exact BPE behavior, while `createTiktokenTokenizer()` remains the one-line real implementation for production wiring.

## Verified locally

`npm run lint`, `npm run typecheck`, `npm test` (61 tests passing, up from 49), `npm run build` all pass clean. No database or live credentials needed — `chunkText` is a pure function, tested directly against both a deterministic fake tokenizer (for exact boundary/overlap assertions) and the real `js-tiktoken` encoder (for round-trip correctness and realistic end-to-end token budgets).

## Next

M7 — Embeddings: define an `EmbeddingProvider` interface (`embed`, `dimensions`), ship an OpenAI `text-embedding-3-small` reference adapter.
