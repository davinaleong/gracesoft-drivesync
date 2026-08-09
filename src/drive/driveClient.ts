import { google } from "googleapis";
import { loadEnv } from "../config/env.js";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export type FolderAccessResult =
  | { accessible: true }
  | { accessible: false; reason: "not-found-or-not-shared" | "not-a-folder" };

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  /** ISO 8601, as returned by the Drive API. */
  modifiedTime: string;
}

export interface DriveClient {
  verifyFolderAccess(folderId: string): Promise<FolderAccessResult>;
  /**
   * Direct children of the folder only (no recursion into subfolders — the
   * connected-folder model is single-level), excluding trashed items and
   * subfolders themselves (only actual files are sync candidates).
   */
  listFiles(folderId: string): Promise<DriveFileMeta[]>;
  /** Google-native files (Docs/Sheets/Slides) only — export as another format. */
  exportAsText(fileId: string, exportMimeType: string): Promise<string>;
  /** Raw file bytes (PDFs and other non-Google-native files). */
  downloadFile(fileId: string): Promise<Buffer>;
}

function statusCodeOf(err: unknown): number | undefined {
  const candidate = err as { code?: number | string; response?: { status?: number } };
  if (typeof candidate?.response?.status === "number") return candidate.response.status;
  if (typeof candidate?.code === "number") return candidate.code;
  return undefined;
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || (typeof status === "number" && status >= 500);
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A carried-forward gap from v1: Drive API 429s/5xxs had no retry at all,
 * so a transient rate-limit response counted as a permanent sync failure
 * for that run instead of resolving itself. Non-retryable errors (404/403,
 * which `verifyFolderAccess` classifies itself) pass straight through on
 * the first attempt.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  sleepFn: (ms: number) => Promise<void>,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries || !isRetryableStatus(statusCodeOf(err))) throw err;
      await sleepFn(backoffMs(attempt));
    }
  }
}

export interface GoogleDriveClientOptions {
  maxRetries?: number;
  /** Test-only hook to avoid real timers in retry/backoff tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

export function createGoogleDriveClient(options: GoogleDriveClientOptions = {}): DriveClient {
  const env = loadEnv();
  const maxRetries = options.maxRetries ?? 3;
  const sleepFn = options.sleepFn ?? sleep;
  const retrying = <T>(fn: () => Promise<T>): Promise<T> => withRetry(fn, maxRetries, sleepFn);

  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // The env var stores the private key with literal "\n" sequences (see
    // .env.example) since real newlines don't survive most .env formats.
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  const drive = google.drive({ version: "v3", auth });

  return {
    async verifyFolderAccess(folderId: string): Promise<FolderAccessResult> {
      try {
        const res = await retrying(() =>
          drive.files.get({
            fileId: folderId,
            fields: "id,mimeType",
            supportsAllDrives: true,
          }),
        );

        if (res.data.mimeType !== FOLDER_MIME_TYPE) {
          return { accessible: false, reason: "not-a-folder" };
        }

        return { accessible: true };
      } catch (err) {
        const status = statusCodeOf(err);
        // 404: doesn't exist, or exists but isn't shared with the service
        // account (Drive returns 404, not 403, for the latter — the API
        // won't confirm a folder's existence to a caller without access).
        if (status === 404 || status === 403) {
          return { accessible: false, reason: "not-found-or-not-shared" };
        }
        throw err;
      }
    },

    async listFiles(folderId: string): Promise<DriveFileMeta[]> {
      const files: DriveFileMeta[] = [];
      let pageToken: string | undefined;

      do {
        const res = await retrying(() =>
          drive.files.list({
            q: `'${folderId}' in parents and trashed = false and mimeType != '${FOLDER_MIME_TYPE}'`,
            fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
            pageSize: 1000,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          }),
        );

        for (const file of res.data.files ?? []) {
          if (!file.id || !file.name || !file.mimeType || !file.modifiedTime) continue;
          files.push({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            modifiedTime: file.modifiedTime,
          });
        }

        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);

      return files;
    },

    async exportAsText(fileId: string, exportMimeType: string): Promise<string> {
      const res = await retrying(() =>
        drive.files.export({ fileId, mimeType: exportMimeType }, { responseType: "text" }),
      );
      return res.data as unknown as string;
    },

    async downloadFile(fileId: string): Promise<Buffer> {
      const res = await retrying(() =>
        drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" }),
      );
      return Buffer.from(res.data as ArrayBuffer);
    },
  };
}
