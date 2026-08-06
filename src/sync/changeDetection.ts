import type { DriveFileMeta } from "../drive/driveClient.js";

/**
 * The minimal shape needed to diff against a fresh Drive listing. Deliberately
 * not tied to any storage — where "previous" comes from (Postgres via the
 * `DriveFile` model) lands in M11; this module only knows how to diff two
 * snapshots.
 */
export interface FileSnapshot {
  id: string;
  modifiedTime: string;
}

export interface FileChanges {
  added: DriveFileMeta[];
  updated: DriveFileMeta[];
  deleted: string[];
}

export function detectChanges(previous: FileSnapshot[], current: DriveFileMeta[]): FileChanges {
  const previousById = new Map(previous.map((file) => [file.id, file]));
  const currentIds = new Set(current.map((file) => file.id));

  const added: DriveFileMeta[] = [];
  const updated: DriveFileMeta[] = [];

  for (const file of current) {
    const prior = previousById.get(file.id);
    if (!prior) {
      added.push(file);
    } else if (prior.modifiedTime !== file.modifiedTime) {
      updated.push(file);
    }
  }

  const deleted = previous.filter((file) => !currentIds.has(file.id)).map((file) => file.id);

  return { added, updated, deleted };
}
