import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ApiKeyRepository } from "../auth/apiKeyRepository.js";
import { createApp } from "../server.js";
import type { RetrievalService } from "./retrievalService.js";

const AUTHORIZED_HEADER = "Bearer dsk_test-key";

function makeApiKeyRepository(): ApiKeyRepository {
  return {
    findActiveByHashedKey: async () => ({ account: { id: "acct_1", name: "Test Account" }, apiKeyId: "key_1" }),
    touchLastUsed: async () => {},
  };
}

describe("POST /query", () => {
  it("returns 200 with results scoped to the caller's account", async () => {
    const retrievalService: RetrievalService = {
      query: vi.fn(async () => [{ text: "chunk body", score: 0.9, fileId: "file-1", fileName: "doc.txt", section: "Intro" }]),
    };

    const app = createApp(makeApiKeyRepository(), undefined, retrievalService);
    const res = await request(app)
      .post("/query")
      .set("Authorization", AUTHORIZED_HEADER)
      .send({ query: "what is this about?" });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { text: "chunk body", score: 0.9, fileId: "file-1", fileName: "doc.txt", section: "Intro" },
    ]);
    expect(retrievalService.query).toHaveBeenCalledWith("acct_1", "what is this about?", 5);
  });

  it("passes a custom topK through", async () => {
    const retrievalService: RetrievalService = { query: vi.fn(async () => []) };
    const app = createApp(makeApiKeyRepository(), undefined, retrievalService);

    await request(app)
      .post("/query")
      .set("Authorization", AUTHORIZED_HEADER)
      .send({ query: "hello", topK: 10 });

    expect(retrievalService.query).toHaveBeenCalledWith("acct_1", "hello", 10);
  });

  it("returns 400 for a missing query", async () => {
    const retrievalService: RetrievalService = { query: vi.fn() };
    const app = createApp(makeApiKeyRepository(), undefined, retrievalService);

    const res = await request(app).post("/query").set("Authorization", AUTHORIZED_HEADER).send({});

    expect(res.status).toBe(400);
    expect(retrievalService.query).not.toHaveBeenCalled();
  });

  it("returns 400 for a topK above the maximum", async () => {
    const retrievalService: RetrievalService = { query: vi.fn() };
    const app = createApp(makeApiKeyRepository(), undefined, retrievalService);

    const res = await request(app)
      .post("/query")
      .set("Authorization", AUTHORIZED_HEADER)
      .send({ query: "hello", topK: 999 });

    expect(res.status).toBe(400);
    expect(retrievalService.query).not.toHaveBeenCalled();
  });

  it("requires a valid API key", async () => {
    const retrievalService: RetrievalService = { query: vi.fn() };
    const app = createApp(makeApiKeyRepository(), undefined, retrievalService);

    const res = await request(app).post("/query").send({ query: "hello" });

    expect(res.status).toBe(401);
    expect(retrievalService.query).not.toHaveBeenCalled();
  });
});
