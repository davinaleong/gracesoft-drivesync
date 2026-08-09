import type { NextFunction, Request, Response } from "express";
import { hashApiKey, looksLikeApiKey } from "../auth/apiKeyCrypto.js";
import type { ApiKeyRepository } from "../auth/apiKeyRepository.js";
import { loadEnv } from "../config/env.js";

declare module "express-serve-static-core" {
  interface Request {
    account?: { id: string; name: string };
  }
}

// Every rejection reason (missing header, malformed key, unknown key,
// revoked key) returns this exact same shape/status — an attacker probing
// keys can't distinguish "wrong format" from "revoked" from "never existed".
const UNAUTHORIZED_BODY = { error: "unauthorized" };

export function createRequireApiKey(repository: ApiKeyRepository) {
  return async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    const header = req.header("authorization");
    const rawKey = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;

    if (!rawKey || !looksLikeApiKey(rawKey)) {
      res.status(401).json(UNAUTHORIZED_BODY);
      return;
    }

    // Express 4 doesn't await async middleware, so a rejected promise here
    // becomes an unhandled rejection that crashes the whole process, not
    // just this request — a single transient DB blip would take the server
    // down for every in-flight request. Routing the error to Express's
    // error-handling chain via next(err) instead keeps a lookup failure
    // scoped to a 500 on this request.
    try {
      const { API_KEY_PEPPER } = loadEnv();
      const hashedKey = hashApiKey(rawKey, API_KEY_PEPPER);
      const result = await repository.findActiveByHashedKey(hashedKey);

      if (!result) {
        res.status(401).json(UNAUTHORIZED_BODY);
        return;
      }

      req.account = result.account;
      void repository.touchLastUsed(result.apiKeyId);
      next();
    } catch (err) {
      next(err);
    }
  };
}
