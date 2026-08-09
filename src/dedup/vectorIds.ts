/**
 * The stable `{fileId}-{chunkIndex}` scheme referenced in M8's milestone
 * description. Chunk index is always the final `-N` segment, so a fileId
 * containing hyphens doesn't create ambiguity for anything built on top of
 * this — nothing here ever needs to parse a fileId back out of a vector ID;
 * fileId and chunk count are tracked separately (M11's `DriveFile` model).
 */
export function buildVectorId(fileId: string, chunkIndex: number): string {
  return `${fileId}-${chunkIndex}`;
}

/**
 * Vector IDs left over from a previous sync that no longer correspond to any
 * current chunk. Covers both cases with one function: a fully deleted file
 * (`currentChunkCount = 0`, every previous chunk is stale) and a modified
 * file that now chunks into fewer pieces than before (the trailing chunk
 * indices from the old count are orphaned even though the file still
 * exists) — the second case is the one that's easy to miss if cleanup is
 * only wired to full-delete events.
 */
export function computeStaleVectorIds(fileId: string, previousChunkCount: number, currentChunkCount: number): string[] {
  const staleIds: string[] = [];
  for (let i = currentChunkCount; i < previousChunkCount; i++) {
    staleIds.push(buildVectorId(fileId, i));
  }
  return staleIds;
}
