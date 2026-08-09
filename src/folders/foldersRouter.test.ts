import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ApiKeyRepository } from "../auth/apiKeyRepository.js";
import { createApp } from "../server.js";
import type { ConnectFolderResult, FolderService, VerifyFolderResult } from "./folderService.js";
import type { FolderRecord } from "./folderRepository.js";

const AUTHORIZED_HEADER = "Bearer dsk_test-key";

function makeApiKeyRepository(): ApiKeyRepository {
  return {
    findActiveByHashedKey: async () => ({ account: { id: "acct_1", name: "Test Account" }, apiKeyId: "key_1" }),
    touchLastUsed: async () => {},
  };
}

function makeFolder(overrides: Partial<FolderRecord> = {}): FolderRecord {
  return {
    id: "folder_1",
    accountId: "acct_1",
    folderId: "folder-abc",
    status: "CONNECTED",
    connectedAt: new Date(),
    lastVerifiedAt: new Date(),
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe("POST /folders", () => {
  it("returns 201 with the folder on success", async () => {
    const folderService: FolderService = {
      connectFolder: vi.fn(async (): Promise<ConnectFolderResult> => ({ ok: true, folder: makeFolder() })),
      verifyFolder: vi.fn(),
      listFolders: vi.fn(),
    };

    const app = createApp(makeApiKeyRepository(), folderService);
    const res = await request(app)
      .post("/folders")
      .set("Authorization", AUTHORIZED_HEADER)
      .send({ folderId: "folder-abc" });

    expect(res.status).toBe(201);
    expect(res.body.folder.status).toBe("CONNECTED");
    expect(folderService.connectFolder).toHaveBeenCalledWith("acct_1", "folder-abc");
  });

  it("returns 422 with an actionable message (not a generic 500/404) when the folder isn't shared yet", async () => {
    const folderService: FolderService = {
      connectFolder: vi.fn(async (): Promise<ConnectFolderResult> => ({ ok: false, reason: "not-found-or-not-shared" })),
      verifyFolder: vi.fn(),
      listFolders: vi.fn(),
    };

    const app = createApp(makeApiKeyRepository(), folderService);
    const res = await request(app)
      .post("/folders")
      .set("Authorization", AUTHORIZED_HEADER)
      .send({ folderId: "folder-abc" });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain("Share it with");
  });

  it("returns 400 for a missing folderId", async () => {
    const folderService: FolderService = {
      connectFolder: vi.fn(),
      verifyFolder: vi.fn(),
      listFolders: vi.fn(),
    };

    const app = createApp(makeApiKeyRepository(), folderService);
    const res = await request(app).post("/folders").set("Authorization", AUTHORIZED_HEADER).send({});

    expect(res.status).toBe(400);
    expect(folderService.connectFolder).not.toHaveBeenCalled();
  });

  it("requires a valid API key", async () => {
    const folderService: FolderService = {
      connectFolder: vi.fn(),
      verifyFolder: vi.fn(),
      listFolders: vi.fn(),
    };

    const app = createApp(makeApiKeyRepository(), folderService);
    const res = await request(app).post("/folders").send({ folderId: "folder-abc" });

    expect(res.status).toBe(401);
    expect(folderService.connectFolder).not.toHaveBeenCalled();
  });
});

describe("GET /folders", () => {
  it("lists folders scoped to the caller's account", async () => {
    const folderService: FolderService = {
      connectFolder: vi.fn(),
      verifyFolder: vi.fn(),
      listFolders: vi.fn(async () => [makeFolder()]),
    };

    const app = createApp(makeApiKeyRepository(), folderService);
    const res = await request(app).get("/folders").set("Authorization", AUTHORIZED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.folders).toHaveLength(1);
    expect(folderService.listFolders).toHaveBeenCalledWith("acct_1");
  });
});

describe("POST /folders/:id/verify", () => {
  it("returns 404 when the folder doesn't belong to the caller's account", async () => {
    const folderService: FolderService = {
      connectFolder: vi.fn(),
      verifyFolder: vi.fn(async (): Promise<VerifyFolderResult> => ({ ok: false, reason: "not-found" })),
      listFolders: vi.fn(),
    };

    const app = createApp(makeApiKeyRepository(), folderService);
    const res = await request(app).post("/folders/nope/verify").set("Authorization", AUTHORIZED_HEADER);

    expect(res.status).toBe(404);
  });

  it("surfaces a clear no-longer-accessible status when access was revoked", async () => {
    const folderService: FolderService = {
      connectFolder: vi.fn(),
      verifyFolder: vi.fn(async (): Promise<VerifyFolderResult> => ({
        ok: false,
        reason: "not-found-or-not-shared",
        folder: makeFolder({ status: "NOT_ACCESSIBLE" }),
      })),
      listFolders: vi.fn(),
    };

    const app = createApp(makeApiKeyRepository(), folderService);
    const res = await request(app).post("/folders/folder_1/verify").set("Authorization", AUTHORIZED_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.folder.status).toBe("NOT_ACCESSIBLE");
    expect(res.body.error).toBeDefined();
  });
});
