/**
 * The pipeline never talks to a specific embeddings API directly — only to
 * this interface. `dimensions` is fixed per provider/model and baked into
 * the vector store index at creation time (see M9): there is no partial or
 * live migration path between providers whose dimensions differ.
 */
export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
