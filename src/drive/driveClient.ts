import { google } from "googleapis";
import { loadEnv } from "../config/env.js";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export type FolderAccessResult =
  | { accessible: true }
  | { accessible: false; reason: "not-found-or-not-shared" | "not-a-folder" };

export interface DriveClient {
  verifyFolderAccess(folderId: string): Promise<FolderAccessResult>;
}

function statusCodeOf(err: unknown): number | undefined {
  const candidate = err as { code?: number | string; response?: { status?: number } };
  if (typeof candidate?.response?.status === "number") return candidate.response.status;
  if (typeof candidate?.code === "number") return candidate.code;
  return undefined;
}

export function createGoogleDriveClient(): DriveClient {
  const env = loadEnv();

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
        const res = await drive.files.get({
          fileId: folderId,
          fields: "id,mimeType",
          supportsAllDrives: true,
        });

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
  };
}
