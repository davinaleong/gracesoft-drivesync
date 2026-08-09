import { createHash } from "node:crypto";

/**
 * Hashes extracted text (post-M5), not raw Drive bytes: Drive's
 * `modifiedTime` (M4's change signal) can change without the actual content
 * changing (metadata-only touches, re-saves with no edits), and hashing
 * post-extraction text is the one representation that's uniform across
 * every file type M5 handles (Docs/Sheets/Slides/PDFs) — there's no single
 * "raw bytes" concept for Google-native files, which are exported, not
 * downloaded.
 */
export function computeContentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * `previousHash` is `undefined` for a file never synced before — always
 * "changed" in that case, since there's nothing to skip re-embedding against.
 */
export function hasContentChanged(previousHash: string | undefined, currentHash: string): boolean {
  return previousHash !== currentHash;
}
