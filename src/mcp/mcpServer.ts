import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RetrievalService } from "../retrieval/retrievalService.js";
import type { DocumentService } from "./documentService.js";

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 50;

/**
 * Built fresh per request (see mcpRouter.ts's stateless wiring) with
 * `accountId` closed over from the caller's already-validated API key — the
 * same account-scoping the REST API gets from `requireApiKey`, just applied
 * at tool-construction time instead of per-call. An MCP client can no more
 * reach another account's data through these tools than a REST client could
 * through `/query`.
 */
export function createDriveSyncMcpServer(deps: {
  accountId: string;
  retrievalService: RetrievalService;
  documentService: DocumentService;
}): McpServer {
  const server = new McpServer({ name: "gracesoft-drivesync", version: "0.1.0" });

  server.registerTool(
    "search",
    {
      title: "Search connected Drive folders",
      description:
        "Search the caller's connected Google Drive folders for relevant chunks. Returns chunk text and source attribution (fileId, fileName, section, score).",
      inputSchema: {
        query: z.string().min(1).describe("Natural-language search query"),
        topK: z.number().int().positive().max(MAX_TOP_K).optional().describe(`Number of results to return (default ${DEFAULT_TOP_K}, max ${MAX_TOP_K})`),
      },
    },
    async ({ query, topK }) => {
      const results = await deps.retrievalService.query(deps.accountId, query, topK ?? DEFAULT_TOP_K);
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    },
  );

  server.registerTool(
    "fetch_document",
    {
      title: "Fetch a full document",
      description:
        "Fetch the full reconstructed text of a specific file by its Drive file ID (from a search result's fileId field), scoped to the caller's own account.",
      inputSchema: {
        fileId: z.string().min(1).describe("The Drive file ID, from a prior search result's fileId field"),
      },
    },
    async ({ fileId }) => {
      const document = await deps.documentService.fetchDocument(deps.accountId, fileId);
      if (!document) {
        return {
          content: [{ type: "text", text: "Document not found, or not accessible to this account." }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(document) }] };
    },
  );

  return server;
}
