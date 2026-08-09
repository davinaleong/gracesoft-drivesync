import { describe, expect, it } from "vitest";
import { buildVectorId, computeStaleVectorIds } from "./vectorIds.js";

describe("buildVectorId", () => {
  it("joins fileId and chunkIndex with a hyphen", () => {
    expect(buildVectorId("file123", 0)).toBe("file123-0");
    expect(buildVectorId("file123", 7)).toBe("file123-7");
  });

  it("stays unambiguous even when fileId itself contains hyphens", () => {
    expect(buildVectorId("my-file-id", 2)).toBe("my-file-id-2");
  });
});

describe("computeStaleVectorIds", () => {
  it("returns no stale IDs when the chunk count is unchanged", () => {
    expect(computeStaleVectorIds("file123", 5, 5)).toEqual([]);
  });

  it("returns no stale IDs when the file has more chunks than before", () => {
    expect(computeStaleVectorIds("file123", 3, 5)).toEqual([]);
  });

  it("returns the trailing chunk IDs when a modified file now has fewer chunks", () => {
    expect(computeStaleVectorIds("file123", 5, 3)).toEqual(["file123-3", "file123-4"]);
  });

  it("returns every previous chunk ID when the file was fully deleted (currentChunkCount = 0)", () => {
    expect(computeStaleVectorIds("file123", 3, 0)).toEqual(["file123-0", "file123-1", "file123-2"]);
  });

  it("returns no stale IDs for a brand-new file with no previous chunks", () => {
    expect(computeStaleVectorIds("file123", 0, 4)).toEqual([]);
  });
});
