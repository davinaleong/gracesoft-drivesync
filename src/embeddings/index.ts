import { loadEnv } from "../config/env.js";
import type { EmbeddingProvider } from "./embeddingProvider.js";
import { createOpenAiEmbeddingClient, createOpenAiEmbeddingProvider } from "./openaiEmbeddingProvider.js";

export type { EmbeddingProvider } from "./embeddingProvider.js";

/**
 * Config-driven selection, not code branching elsewhere in the pipeline: a
 * contributor adding a new provider implements `EmbeddingProvider` and adds
 * one case here — no dynamic plugin loading.
 */
export function createEmbeddingProvider(): EmbeddingProvider {
  const env = loadEnv();

  switch (env.EMBEDDING_PROVIDER) {
    case "openai":
      return createOpenAiEmbeddingProvider({
        client: createOpenAiEmbeddingClient(env.OPENAI_API_KEY),
        model: env.OPENAI_EMBEDDING_MODEL,
      });
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER "${env.EMBEDDING_PROVIDER}". Supported: openai.`);
  }
}
