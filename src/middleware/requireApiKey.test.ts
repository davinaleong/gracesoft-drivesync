import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "../auth/apiKeyCrypto.js";
import type { ApiKeyRepository } from "../auth/apiKeyRepository.js";
import { createRequireApiKey } from "./requireApiKey.js";

const PEPPER = "test-pepper-not-for-production-use-only"; // matches vitest.config.ts env
const VALID_RAW_KEY = "dsk_valid-key-for-tests";
const VALID_HASH = hashApiKey(VALID_RAW_KEY, PEPPER);

function makeRepository(overrides: Partial<ApiKeyRepository> = {}): ApiKeyRepository {
  return {
    findActiveByHashedKey: vi.fn(async (hashedKey: string) => {
      if (hashedKey === VALID_HASH) {
        return { account: { id: "acct_1", name: "Test Account" }, apiKeyId: "key_1" };
      }
      return null;
    }),
    touchLastUsed: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeReqRes(authHeader?: string) {
  const req = {
    header: (name: string) => (name.toLowerCase() === "authorization" ? authHeader : undefined),
    account: undefined,
  } as unknown as Request;

  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as unknown as Response;

  const next = vi.fn() as NextFunction;

  return { req, res, status, json, next };
}

describe("requireApiKey", () => {
  let repository: ApiKeyRepository;

  beforeEach(() => {
    repository = makeRepository();
  });

  it("accepts a valid key and resolves it to the correct account", async () => {
    const { req, res, next } = makeReqRes(`Bearer ${VALID_RAW_KEY}`);
    await createRequireApiKey(repository)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.account).toEqual({ id: "acct_1", name: "Test Account" });
    expect(repository.touchLastUsed).toHaveBeenCalledWith("key_1");
  });

  it("rejects a missing Authorization header", async () => {
    const { req, res, status, json, next } = makeReqRes(undefined);
    await createRequireApiKey(repository)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "unauthorized" });
  });

  it("rejects a malformed key with the same shape as other failures", async () => {
    const { req, res, status, json, next } = makeReqRes("Bearer not-a-real-key");
    await createRequireApiKey(repository)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "unauthorized" });
  });

  it("rejects an unknown key with the same shape as other failures", async () => {
    const { req, res, status, json, next } = makeReqRes("Bearer dsk_unknown-key");
    await createRequireApiKey(repository)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "unauthorized" });
  });

  it("rejects a revoked key with the same shape as other failures", async () => {
    // The repository is responsible for excluding revoked keys from lookups —
    // simulate that by returning null even for what looks like a valid hash.
    const revokedRepository = makeRepository({
      findActiveByHashedKey: vi.fn(async () => null),
    });
    const { req, res, status, json, next } = makeReqRes(`Bearer ${VALID_RAW_KEY}`);
    await createRequireApiKey(revokedRepository)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "unauthorized" });
  });
});
