export interface VectorRecord {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
}

export interface ScoredVectorRecord {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * The pipeline never talks to a specific vector database directly — only to
 * this interface. Every operation is namespace-scoped: namespaces are how
 * per-account isolation is enforced (see M8's namespace-isolation decision),
 * not an optional extra.
 */
export interface VectorStore {
  upsert(namespace: string, records: VectorRecord[]): Promise<void>;
  query(namespace: string, vector: number[], topK: number): Promise<ScoredVectorRecord[]>;
  delete(namespace: string, ids: string[]): Promise<void>;
  /** Fetch by exact ID rather than similarity — what M14's document-fetch reconstructs a full file from. Missing IDs are simply absent from the result, not an error. */
  fetch(namespace: string, ids: string[]): Promise<VectorRecord[]>;
  /**
   * The dimension the underlying index/collection was created with, or
   * `undefined` if that isn't knowable yet (e.g. a brand-new index with no
   * dimension reported until data exists). Used to enforce M9's provider-swap
   * rule: an `EmbeddingProvider`'s dimension must match this, or the two are
   * incompatible without a full resync.
   */
  getDimension(): Promise<number | undefined>;
}
