import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { DocumentResult, DocumentService } from "./documentService.js";
import { createDriveSyncMcpServer } from "./mcpServer.js";
import type { RetrievedChunk, RetrievalService } from "../retrieval/retrievalService.js";

async function connectedClient(deps: { retrievalService: RetrievalService; documentService: DocumentService; accountId?: string }) {
  const server = createDriveSyncMcpServer({
    accountId: deps.accountId ?? "acct_1",
    retrievalService: deps.retrievalService,
    documentService: deps.documentService,
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function makeRetrievalService(results: RetrievedChunk[]): RetrievalService {
  return { query: vi.fn(async () => results) };
}

function makeDocumentService(result: DocumentResult | null): DocumentService {
  return { fetchDocument: vi.fn(async () => result) };
}

describe("createDriveSyncMcpServer", () => {
  it("exposes search and fetch_document as tools", async () => {
    const client = await connectedClient({ retrievalService: makeRetrievalService([]), documentService: makeDocumentService(null) });

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(["fetch_document", "search"]);
  });

  it("search calls retrievalService.query scoped to the accountId baked in at construction, and returns results as text", async () => {
    const retrievalService = makeRetrievalService([
      { text: "chunk body", score: 0.9, fileId: "file-1", fileName: "doc.txt", section: "Intro" },
    ]);
    const client = await connectedClient({ retrievalService, documentService: makeDocumentService(null), accountId: "acct_42" });

    const result = await client.callTool({ name: "search", arguments: { query: "what is this about?" } });

    expect(retrievalService.query).toHaveBeenCalledWith("acct_42", "what is this about?", 5);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0]!.text)).toEqual([
      { text: "chunk body", score: 0.9, fileId: "file-1", fileName: "doc.txt", section: "Intro" },
    ]);
  });

  it("search passes a custom topK through", async () => {
    const retrievalService = makeRetrievalService([]);
    const client = await connectedClient({ retrievalService, documentService: makeDocumentService(null) });

    await client.callTool({ name: "search", arguments: { query: "hello", topK: 10 } });

    expect(retrievalService.query).toHaveBeenCalledWith("acct_1", "hello", 10);
  });

  it("fetch_document returns the reconstructed document as text", async () => {
    const documentService = makeDocumentService({ fileId: "file-1", fileName: "doc.txt", text: "full document text" });
    const client = await connectedClient({ retrievalService: makeRetrievalService([]), documentService, accountId: "acct_7" });

    const result = await client.callTool({ name: "fetch_document", arguments: { fileId: "file-1" } });

    expect(documentService.fetchDocument).toHaveBeenCalledWith("acct_7", "file-1");
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0]!.text)).toEqual({ fileId: "file-1", fileName: "doc.txt", text: "full document text" });
  });

  it("fetch_document reports isError for a document that isn't found or isn't the caller's", async () => {
    const client = await connectedClient({ retrievalService: makeRetrievalService([]), documentService: makeDocumentService(null) });

    const result = await client.callTool({ name: "fetch_document", arguments: { fileId: "not-mine" } });

    expect(result.isError).toBe(true);
  });
});
