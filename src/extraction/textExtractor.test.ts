import { describe, expect, it, vi } from "vitest";
import type { DriveClient, DriveFileMeta } from "../drive/driveClient.js";
import type { PdfParser } from "./textExtractor.js";
import { createTextExtractor } from "./textExtractor.js";

function file(overrides: Partial<DriveFileMeta> = {}): DriveFileMeta {
  return {
    id: "file_1",
    name: "doc",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDriveClient(overrides: Partial<DriveClient> = {}): DriveClient {
  return {
    verifyFolderAccess: vi.fn(),
    listFiles: vi.fn(),
    exportAsText: vi.fn(async () => ""),
    downloadFile: vi.fn(async () => Buffer.from("")),
    ...overrides,
  };
}

function makePdfParser(text: string): PdfParser {
  return { parse: vi.fn(async () => ({ text })) };
}

describe("createTextExtractor", () => {
  it("exports Google Docs as plain text", async () => {
    const driveClient = makeDriveClient({ exportAsText: vi.fn(async () => "hello doc") });
    const extractor = createTextExtractor({ driveClient, pdfParser: makePdfParser("") });

    const result = await extractor.extractText(file({ mimeType: "application/vnd.google-apps.document" }));

    expect(result).toEqual({ ok: true, text: "hello doc" });
    expect(driveClient.exportAsText).toHaveBeenCalledWith("file_1", "text/plain");
  });

  it("exports Google Slides as plain text", async () => {
    const driveClient = makeDriveClient({ exportAsText: vi.fn(async () => "hello slides") });
    const extractor = createTextExtractor({ driveClient, pdfParser: makePdfParser("") });

    const result = await extractor.extractText(file({ mimeType: "application/vnd.google-apps.presentation" }));

    expect(result).toEqual({ ok: true, text: "hello slides" });
    expect(driveClient.exportAsText).toHaveBeenCalledWith("file_1", "text/plain");
  });

  it("exports Google Sheets as CSV", async () => {
    const driveClient = makeDriveClient({ exportAsText: vi.fn(async () => "a,b\n1,2") });
    const extractor = createTextExtractor({ driveClient, pdfParser: makePdfParser("") });

    const result = await extractor.extractText(file({ mimeType: "application/vnd.google-apps.spreadsheet" }));

    expect(result).toEqual({ ok: true, text: "a,b\n1,2" });
    expect(driveClient.exportAsText).toHaveBeenCalledWith("file_1", "text/csv");
  });

  it("downloads and parses PDFs with a text layer", async () => {
    const driveClient = makeDriveClient({ downloadFile: vi.fn(async () => Buffer.from("pdf-bytes")) });
    const extractor = createTextExtractor({ driveClient, pdfParser: makePdfParser("  real pdf text  ") });

    const result = await extractor.extractText(file({ mimeType: "application/pdf" }));

    expect(result).toEqual({ ok: true, text: "real pdf text" });
  });

  it("fails closed with a specific reason for a scanned PDF (no text layer)", async () => {
    const driveClient = makeDriveClient();
    const extractor = createTextExtractor({ driveClient, pdfParser: makePdfParser("   ") });

    const result = await extractor.extractText(file({ mimeType: "application/pdf" }));

    expect(result).toEqual({ ok: false, reason: "scanned-pdf-ocr-not-implemented" });
  });

  it("fails closed for an unsupported mime type instead of silently returning nothing", async () => {
    const driveClient = makeDriveClient();
    const extractor = createTextExtractor({ driveClient, pdfParser: makePdfParser("") });

    const result = await extractor.extractText(file({ mimeType: "image/png" }));

    expect(result).toEqual({ ok: false, reason: "unsupported-mime-type" });
  });
});
