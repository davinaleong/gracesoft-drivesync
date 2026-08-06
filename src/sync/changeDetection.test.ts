import { describe, expect, it } from "vitest";
import type { DriveFileMeta } from "../drive/driveClient.js";
import { detectChanges } from "./changeDetection.js";

function file(overrides: Partial<DriveFileMeta> = {}): DriveFileMeta {
  return {
    id: "file_1",
    name: "doc.txt",
    mimeType: "text/plain",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("detectChanges", () => {
  it("reports every current file as added when there is no previous state", () => {
    const current = [file({ id: "a" }), file({ id: "b" })];
    const result = detectChanges([], current);

    expect(result.added).toEqual(current);
    expect(result.updated).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it("does not report unchanged files", () => {
    const previous = [{ id: "a", modifiedTime: "2026-01-01T00:00:00.000Z" }];
    const current = [file({ id: "a", modifiedTime: "2026-01-01T00:00:00.000Z" })];

    const result = detectChanges(previous, current);

    expect(result.added).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it("reports a file as updated when its modifiedTime changes", () => {
    const previous = [{ id: "a", modifiedTime: "2026-01-01T00:00:00.000Z" }];
    const current = [file({ id: "a", modifiedTime: "2026-02-01T00:00:00.000Z" })];

    const result = detectChanges(previous, current);

    expect(result.updated).toEqual(current);
    expect(result.added).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it("reports a file as deleted when it's missing from the current listing", () => {
    const previous = [
      { id: "a", modifiedTime: "2026-01-01T00:00:00.000Z" },
      { id: "b", modifiedTime: "2026-01-01T00:00:00.000Z" },
    ];
    const current = [file({ id: "a", modifiedTime: "2026-01-01T00:00:00.000Z" })];

    const result = detectChanges(previous, current);

    expect(result.deleted).toEqual(["b"]);
    expect(result.added).toEqual([]);
    expect(result.updated).toEqual([]);
  });

  it("handles a mix of added, updated, and deleted files in one diff", () => {
    const previous = [
      { id: "unchanged", modifiedTime: "2026-01-01T00:00:00.000Z" },
      { id: "stale", modifiedTime: "2026-01-01T00:00:00.000Z" },
      { id: "gone", modifiedTime: "2026-01-01T00:00:00.000Z" },
    ];
    const current = [
      file({ id: "unchanged", modifiedTime: "2026-01-01T00:00:00.000Z" }),
      file({ id: "stale", modifiedTime: "2026-03-01T00:00:00.000Z" }),
      file({ id: "new", modifiedTime: "2026-03-01T00:00:00.000Z" }),
    ];

    const result = detectChanges(previous, current);

    expect(result.added.map((f) => f.id)).toEqual(["new"]);
    expect(result.updated.map((f) => f.id)).toEqual(["stale"]);
    expect(result.deleted).toEqual(["gone"]);
  });
});
