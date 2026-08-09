# Adding a provider

This is the main contribution surface this project is designed around: the pipeline never talks to a specific embeddings API or vector database directly, only to two interfaces. OpenAI and Pinecone ship as the reference implementations, but neither is hardcoded into the pipeline itself.

## `EmbeddingProvider`

```typescript
// src/embeddings/embeddingProvider.ts
export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
```

`dimensions` is fixed per provider/model and gets baked into the vector store index at creation time — there's no partial or live migration path between providers with different dimensions (see [M9's provider-swap decision](../_internal-docs/progress/M09-provider-swap-behavior.md)).

### Steps

1. Create `src/embeddings/yourProviderEmbeddingProvider.ts`. Look at `src/embeddings/openaiEmbeddingProvider.ts` for the reference shape: a thin injected client interface (`OpenAiEmbeddingClient`) wrapping the real SDK, and a `createYourProviderEmbeddingProvider({ client, ... })` factory that does batching/retry around it. The injected-client seam is what lets your adapter's *logic* (batching, retry policy) be unit tested without needing real API credentials — only the thin client wrapper touches the real SDK.
2. Add a case to the registry in `src/embeddings/index.ts`:
   ```typescript
   case "your-provider":
     return createYourProviderEmbeddingProvider({ client: createYourProviderClient(env.YOUR_PROVIDER_API_KEY) });
   ```
3. Write `src/embeddings/yourProviderEmbeddingProvider.test.ts`. It **must** call the shared contract suite:
   ```typescript
   import { defineEmbeddingProviderContractTests } from "./embeddingProvider.contract.js";

   defineEmbeddingProviderContractTests("YourProvider adapter", () =>
     createYourProviderEmbeddingProvider({ client: makeFakeClient() }),
   );
   ```
   The contract suite checks properties every implementation must satisfy: empty input handling, correct output shape/dimensions, surviving input larger than one internal batch. This is what stops an adapter that compiles from silently returning wrong-shaped data.
4. Add any adapter-specific tests (retry/backoff behavior, batch-order preservation) in the same file, following `openaiEmbeddingProvider.test.ts`'s pattern.

## `VectorStore`

```typescript
// src/vectorstore/vectorStore.ts
export interface VectorStore {
  upsert(namespace: string, records: VectorRecord[]): Promise<void>;
  query(namespace: string, vector: number[], topK: number): Promise<ScoredVectorRecord[]>;
  delete(namespace: string, ids: string[]): Promise<void>;
  fetch(namespace: string, ids: string[]): Promise<VectorRecord[]>;
  getDimension(): Promise<number | undefined>;
}
```

Every operation is namespace-scoped. Namespaces are how per-account isolation is enforced — this project is multi-tenant, and `namespace` is always the account ID. **Getting namespace isolation right is the single most important property a new adapter must have.**

### Steps

1. Create `src/vectorstore/yourStoreVectorStore.ts`, following `pineconeVectorStore.ts`'s shape: an injected thin client interface, and a `createYourStoreVectorStore({ client })` factory implementing `VectorStore` in terms of it.
2. Add a case to `src/vectorstore/index.ts`'s registry.
3. Write the contract suite against your adapter:
   ```typescript
   import { defineVectorStoreContractTests } from "./vectorStore.contract.js";

   defineVectorStoreContractTests("YourStore adapter", () =>
     createYourStoreVectorStore({ client: makeFakeClient() }),
     settleDelayMs, // 0 for a fake; a real backend with eventual consistency may need a short delay
   );
   ```
   This is **required**, not optional, before a PR adding a new adapter will be merged. It checks: upsert-then-query round-trips return the closest match, delete removes a record from subsequent queries, and — critically — **namespace isolation**: two namespaces with the same vector ID and content never leak into each other. A new adapter that technically compiles but shares state across namespaces would silently let one tenant see another's data; this suite is what catches that before it ships.
4. If your fake client needs to simulate similarity search for the contract suite to produce meaningful results (not just canned responses), see `pineconeVectorStore.test.ts`'s in-memory fake — it implements real cosine similarity, not just fixed return values, precisely because the contract suite's assertions are semantic ("the closest vector comes back"), not just shape checks.

## What you don't need to build

- A plugin-loading system. The registries in `src/embeddings/index.ts` and `src/vectorstore/index.ts` are plain `switch` statements — add one `case`, done. No dynamic discovery, no separate package convention.
- Retry/backoff logic in the interface itself — that's adapter-specific (it depends on how your API reports transient failures) and lives inside your adapter, not the shared interface.
