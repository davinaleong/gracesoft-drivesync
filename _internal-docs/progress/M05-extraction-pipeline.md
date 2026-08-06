# M5 — Extraction pipeline

Status: **Done**

## What was built

- `src/drive/driveClient.ts` — extended `DriveClient` with `exportAsText(fileId, exportMimeType)` (Drive's native export, for Google Docs/Sheets/Slides) and `downloadFile(fileId)` (raw bytes via `alt=media`, for PDFs and other non-Google-native files).
- `src/extraction/textExtractor.ts` — `createTextExtractor({ driveClient, pdfParser })` dispatches on `DriveFileMeta.mimeType`:
  - Google Docs / Slides → `exportAsText(id, "text/plain")`.
  - Google Sheets → `exportAsText(id, "text/csv")` (first sheet only — see Decisions).
  - PDFs → `downloadFile(id)` + injected `PdfParser.parse()`; empty/whitespace-only result fails closed as `scanned-pdf-ocr-not-implemented` rather than returning empty text.
  - Anything else → fails closed as `unsupported-mime-type`.
  - `createPdfParser()` — the real implementation, wrapping the `pdf-parse` v2 package (`new PDFParse({ data: buffer }).getText()`, `.destroy()` to free the underlying worker).
- `src/extraction/textExtractor.test.ts` — one test per dispatch branch (Doc, Slides, Sheet, PDF-with-text, PDF-without-text, unsupported type), all against a fake `DriveClient` + fake `PdfParser`.
- Added `pdf-parse@2.4.5` as a dependency.
- Updated the fake `DriveClient` objects in `src/folders/folderService.test.ts` to implement the two new interface methods (no-ops — `FolderService` never calls them; TypeScript's structural typing just requires the shape to be complete).

## Decisions

- **`PdfParser` is an injected interface, not a direct `pdf-parse` import inside the dispatch function.** Same DI seam used everywhere else in this codebase (`DriveClient`, `FolderRepository`, `ApiKeyRepository`) — keeps `textExtractor.test.ts` from needing real PDF bytes or the real parsing library at all, while `createPdfParser()` remains a one-line real implementation for production wiring.
- **Scanned-PDF OCR is an explicit fast-follow, not v2-launch scope.** This was the specific decision the milestone checklist called for up front. Rationale: OCR is a materially different capability (needs a vision/OCR model or service, not just a parsing library) and was already a known gap in v1 — re-scoping it into v2's initial extraction pass would block the whole milestone on a much larger feature. Instead, a scanned PDF (no extractable text layer) fails closed with `scanned-pdf-ocr-not-implemented`, a specific reason a caller can act on (skip, log, or one day route to an OCR fast-follow), rather than silently returning empty text that a later pipeline stage might mistake for "this file genuinely has no content."
- **Google Sheets export uses `text/csv`, which only captures the first sheet of a multi-sheet spreadsheet.** Drive's export API doesn't offer a single-call "all sheets as text" option; capturing every sheet would mean either multiple export calls (needs per-sheet IDs, more API surface) or exporting to a spreadsheet format and parsing it locally (a real dependency and complexity increase for a case that may not matter to most connected folders). Flagged here rather than solved, consistent with how the scanned-PDF gap is flagged rather than blocking the milestone — a candidate fast-follow if it turns out to matter in practice.
- **Unsupported mime types fail closed, not silently skipped.** A file type the extractor doesn't know how to handle (an image, a video, an unrecognized format) returns `{ ok: false, reason: "unsupported-mime-type" }` rather than `{ ok: true, text: "" }` — consistent with the same "fail closed with a specific reason" principle applied to scanned PDFs, and setting up M10's dedup/M15's observability to have something concrete to log rather than a silent no-op.

## Verified locally

- `npm run lint`, `npm run typecheck`, `npm test` (49 tests passing, up from 43), `npm run build` all pass clean.
- Manual sanity check of the real `pdf-parse` integration (not just the mocked unit tests) against two real, locally generated PDFs (via macOS's `cupsfilter`, not committed anywhere): a text PDF, confirming `createPdfParser()` correctly extracts the real text through the actual `pdf-parse` v2 API (constructor shape, `getText()`, `.destroy()`); and an image-only PDF, confirming the real library returns no meaningful text for image content (the specific "fails closed" assertion is otherwise covered by the mocked unit test, since `cupsfilter`'s image-to-PDF conversion turned out to inject its own page-footer text, making it an imperfect real-world stand-in for an actual scanned document).

## Explicitly not covered by this pass

- **Real Drive API integration** — `exportAsText`/`downloadFile` have never been exercised against real Google Docs/Sheets/Slides/PDF files via the actual Drive API (only through the fake `DriveClient` in unit tests, plus the standalone `pdf-parse` sanity check above). Tracked under the testing checklist's Integration tests section ("Extraction across file types... real fixtures for each"), consistent with M3/M4's deferral of real-credential passes — `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` in the local `.env` is still misconfigured (being fixed by the account owner directly).

## Next

M6 — Chunking: token-budgeted chunks with overlap, section/heading metadata preserved.
