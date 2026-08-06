import { PDFParse } from "pdf-parse";
import type { DriveClient, DriveFileMeta } from "../drive/driveClient.js";

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";
const PDF_MIME = "application/pdf";

export type ExtractionResult =
  | { ok: true; text: string }
  | { ok: false; reason: "unsupported-mime-type" | "scanned-pdf-ocr-not-implemented" };

export interface PdfParser {
  parse(buffer: Buffer): Promise<{ text: string }>;
}

export interface TextExtractor {
  extractText(file: DriveFileMeta): Promise<ExtractionResult>;
}

export function createTextExtractor(deps: { driveClient: DriveClient; pdfParser: PdfParser }): TextExtractor {
  return {
    async extractText(file: DriveFileMeta): Promise<ExtractionResult> {
      switch (file.mimeType) {
        case GOOGLE_DOC_MIME:
        case GOOGLE_SLIDES_MIME: {
          const text = await deps.driveClient.exportAsText(file.id, "text/plain");
          return { ok: true, text };
        }

        // Drive's CSV export only captures the first sheet of a multi-sheet
        // spreadsheet — a known limitation carried forward from v1. Not
        // solved here; see M5 progress doc.
        case GOOGLE_SHEET_MIME: {
          const text = await deps.driveClient.exportAsText(file.id, "text/csv");
          return { ok: true, text };
        }

        case PDF_MIME: {
          const buffer = await deps.driveClient.downloadFile(file.id);
          const { text } = await deps.pdfParser.parse(buffer);
          const trimmed = text.trim();
          if (!trimmed) {
            // A PDF with no extractable text layer is (almost always) a
            // scanned image. OCR is an explicit fast-follow, not v2-launch
            // scope — fail closed with a specific reason instead of
            // silently returning empty text that downstream stages would
            // mistake for "this file has no content."
            return { ok: false, reason: "scanned-pdf-ocr-not-implemented" };
          }
          return { ok: true, text: trimmed };
        }

        default:
          return { ok: false, reason: "unsupported-mime-type" };
      }
    },
  };
}

export function createPdfParser(): PdfParser {
  return {
    async parse(buffer: Buffer): Promise<{ text: string }> {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return { text: result.text };
      } finally {
        await parser.destroy();
      }
    },
  };
}
