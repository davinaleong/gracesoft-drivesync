import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express } from "express";
import type { ApiKeyRepository } from "../auth/apiKeyRepository.js";
import { createRequireApiKey } from "../middleware/requireApiKey.js";
import type { RetrievalService } from "../retrieval/retrievalService.js";
import type { DocumentService } from "./documentService.js";
import { createDriveSyncMcpServer } from "./mcpServer.js";

const JSON_RPC_METHOD_NOT_ALLOWED = { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null };
const JSON_RPC_INTERNAL_ERROR = { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null };

/**
 * Stateless: a fresh `McpServer` + transport per request, scoped to whichever
 * account the API key resolved to. An MCP client with an invalid/revoked key
 * is rejected by the same `requireApiKey` middleware the REST API uses —
 * identical 401 shape, no separate auth path to keep in sync.
 */
export function createMcpApp(deps: {
  apiKeyRepository: ApiKeyRepository;
  retrievalService: RetrievalService;
  documentService: DocumentService;
}): Express {
  const app = express();
  app.use(express.json());

  const requireApiKey = createRequireApiKey(deps.apiKeyRepository);

  app.post("/mcp", requireApiKey, async (req, res) => {
    const server = createDriveSyncMcpServer({
      accountId: req.account!.id,
      retrievalService: deps.retrievalService,
      documentService: deps.documentService,
    });

    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch {
      if (!res.headersSent) {
        res.status(500).json(JSON_RPC_INTERNAL_ERROR);
      }
    }
  });

  app.get("/mcp", requireApiKey, (_req, res) => {
    res.status(405).json(JSON_RPC_METHOD_NOT_ALLOWED);
  });

  app.delete("/mcp", requireApiKey, (_req, res) => {
    res.status(405).json(JSON_RPC_METHOD_NOT_ALLOWED);
  });

  return app;
}
