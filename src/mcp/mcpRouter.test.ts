import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiKeyRepository } from "../auth/apiKeyRepository.js";
import type { DocumentService } from "./documentService.js";
import { createMcpApp } from "./mcpRouter.js";
import type { RetrievalService } from "../retrieval/retrievalService.js";

const VALID_KEY = "dsk_test-key";

function makeApiKeyRepository(): ApiKeyRepository {
  return {
    // We don't care about the exact hash here, just that *some* key
    // resolves — the "no header" test exercises the actual rejection path.
    findActiveByHashedKey: vi.fn(async () => {
      return { account: { id: "acct_1", name: "Test Account" }, apiKeyId: "key_1" };
    }),
    touchLastUsed: vi.fn(async () => {}),
  };
}

async function startApp(deps: { retrievalService: RetrievalService; documentService: DocumentService }) {
  const app = createMcpApp({ apiKeyRepository: makeApiKeyRepository(), ...deps });
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  return { server, url: new URL(`http://127.0.0.1:${port}/mcp`) };
}

async function connectClient(url: URL, headers?: Record<string, string>) {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${VALID_KEY}`, ...headers } },
  });
  await client.connect(transport);
  return client;
}

describe("createMcpApp", () => {
  let server: import("node:http").Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("serves search and fetch_document over real streamable HTTP, scoped to the resolved account", async () => {
    const retrievalService: RetrievalService = {
      query: vi.fn(async () => [{ text: "chunk body", score: 0.9, fileId: "file-1", fileName: "doc.txt" }]),
    };
    const documentService: DocumentService = { fetchDocument: vi.fn(async () => null) };

    const started = await startApp({ retrievalService, documentService });
    server = started.server;

    const client = await connectClient(started.url);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["fetch_document", "search"]);

    const result = await client.callTool({ name: "search", arguments: { query: "hello" } });
    expect(retrievalService.query).toHaveBeenCalledWith("acct_1", "hello", 5);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0]!.text)).toEqual([
      { text: "chunk body", score: 0.9, fileId: "file-1", fileName: "doc.txt" },
    ]);
  });

  it("rejects a request with no Authorization header the same way the REST API would", async () => {
    const started = await startApp({
      retrievalService: { query: vi.fn() },
      documentService: { fetchDocument: vi.fn() },
    });
    server = started.server;

    const res = await fetch(started.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects GET and DELETE without requiring MCP session state", async () => {
    const started = await startApp({
      retrievalService: { query: vi.fn() },
      documentService: { fetchDocument: vi.fn() },
    });
    server = started.server;

    const getRes = await fetch(started.url, { headers: { Authorization: `Bearer ${VALID_KEY}` } });
    expect(getRes.status).toBe(405);

    const deleteRes = await fetch(started.url, { method: "DELETE", headers: { Authorization: `Bearer ${VALID_KEY}` } });
    expect(deleteRes.status).toBe(405);
  });
});
