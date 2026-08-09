import type { EmbeddingProvider } from "../embeddings/embeddingProvider.js";
import type { VectorStore } from "./vectorStore.js";

/**
 * Embedding dimension is fixed per provider/model and baked into the vector
 * store index/collection at creation time — there is no partial or live
 * migration path between providers whose dimensions differ (see M9). This is
 * the enforcement point: call it before any sync work touches the vector
 * store, so a provider/model swap on a deployment with existing data fails
 * fast with an actionable message instead of silently writing
 * wrong-dimension vectors or corrupting the index.
 *
 * A vector store with no reported dimension yet (brand-new index, no data)
 * is treated as compatible with anything — there's nothing to conflict with.
 */
export async function assertEmbeddingDimensionMatchesVectorStore(
  embeddingProvider: EmbeddingProvider,
  vectorStore: VectorStore,
): Promise<void> {
  const existingDimension = await vectorStore.getDimension();
  if (existingDimension === undefined) return;

  if (existingDimension !== embeddingProvider.dimensions) {
    throw new Error(
      `EmbeddingProvider dimension (${embeddingProvider.dimensions}) does not match the existing ` +
        `vector store index dimension (${existingDimension}). Switching embedding providers or models ` +
        `on a deployment with existing data requires a full resync into a new index/collection created ` +
        `with the new dimension — there is no partial or live migration path.`,
    );
  }
}
