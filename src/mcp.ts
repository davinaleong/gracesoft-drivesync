import { fileURLToPath } from "node:url";
import { createPrismaApiKeyRepository } from "./auth/apiKeyRepository.js";
import { loadEnv } from "./config/env.js";
import { createEmbeddingProvider } from "./embeddings/index.js";
import { logger } from "./lib/logger.js";
import { createDocumentService } from "./mcp/documentService.js";
import { createMcpApp } from "./mcp/mcpRouter.js";
import { createRetrievalService } from "./retrieval/retrievalService.js";
import { createPrismaFileRepository } from "./sync/fileRepository.js";
import { createVectorStore } from "./vectorstore/index.js";

const env = loadEnv();

export function createApp() {
  const embeddingProvider = createEmbeddingProvider();
  const vectorStore = createVectorStore();

  return createMcpApp({
    apiKeyRepository: createPrismaApiKeyRepository(),
    retrievalService: createRetrievalService({ embeddingProvider, vectorStore }),
    documentService: createDocumentService({ fileRepository: createPrismaFileRepository(), vectorStore }),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApp();
  app.listen(env.MCP_SERVER_PORT, () => {
    logger.info({ port: env.MCP_SERVER_PORT }, "MCP server listening");
  });
}
