import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ApiKeyRepository } from "../auth/apiKeyRepository.js";
import { createApp } from "../server.js";
import type { ObservabilityService } from "./observabilityService.js";

const AUTHORIZED_HEADER = "Bearer dsk_test-key";

function makeApiKeyRepository(): ApiKeyRepository {
  return {
    findActiveByHashedKey: async () => ({ account: { id: "acct_1", name: "Test Account" }, apiKeyId: "key_1" }),
    touchLastUsed: async () => {},
  };
}

describe("GET /status", () => {
  it("returns 200 with the caller's folder statuses", async () => {
    const observabilityService: ObservabilityService = {
      getStatus: vi.fn(async () => [
        {
          driveFolderId: "folder_1",
          folderId: "drive-folder-1",
          status: "CONNECTED" as const,
          lastSyncedAt: null,
          lastSyncStatus: null,
          lastSyncError: null,
          consecutiveFailures: 0,
          fileCount: 0,
        },
      ]),
      getAudit: vi.fn(),
    };

    const app = createApp(makeApiKeyRepository(), undefined, undefined, observabilityService);
    const res = await request(app).get("/status").set("Authorization", AUTHORIZED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.folders).toHaveLength(1);
    expect(observabilityService.getStatus).toHaveBeenCalledWith("acct_1");
  });

  it("requires a valid API key", async () => {
    const observabilityService: ObservabilityService = { getStatus: vi.fn(), getAudit: vi.fn() };
    const app = createApp(makeApiKeyRepository(), undefined, undefined, observabilityService);

    const res = await request(app).get("/status");

    expect(res.status).toBe(401);
    expect(observabilityService.getStatus).not.toHaveBeenCalled();
  });
});

describe("GET /audit", () => {
  it("returns 200 with the caller's index totals", async () => {
    const observabilityService: ObservabilityService = {
      getStatus: vi.fn(),
      getAudit: vi.fn(async () => ({ totalFiles: 5, totalChunks: 42, folders: [] })),
    };

    const app = createApp(makeApiKeyRepository(), undefined, undefined, observabilityService);
    const res = await request(app).get("/audit").set("Authorization", AUTHORIZED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ totalFiles: 5, totalChunks: 42, folders: [] });
    expect(observabilityService.getAudit).toHaveBeenCalledWith("acct_1");
  });

  it("requires a valid API key", async () => {
    const observabilityService: ObservabilityService = { getStatus: vi.fn(), getAudit: vi.fn() };
    const app = createApp(makeApiKeyRepository(), undefined, undefined, observabilityService);

    const res = await request(app).get("/audit");

    expect(res.status).toBe(401);
    expect(observabilityService.getAudit).not.toHaveBeenCalled();
  });
});
