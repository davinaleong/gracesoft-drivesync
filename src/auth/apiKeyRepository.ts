import type { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export interface ApiKeyLookupResult {
  account: { id: string; name: string };
  apiKeyId: string;
}

export interface ApiKeyRepository {
  findActiveByHashedKey(hashedKey: string): Promise<ApiKeyLookupResult | null>;
  touchLastUsed(apiKeyId: string): Promise<void>;
}

export function createPrismaApiKeyRepository(client: PrismaClient = prisma): ApiKeyRepository {
  return {
    async findActiveByHashedKey(hashedKey) {
      const apiKey = await client.apiKey.findUnique({
        where: { hashedKey },
        include: { account: true },
      });

      if (!apiKey || apiKey.revokedAt) return null;

      return {
        account: { id: apiKey.account.id, name: apiKey.account.name },
        apiKeyId: apiKey.id,
      };
    },

    async touchLastUsed(apiKeyId) {
      await client.apiKey.update({
        where: { id: apiKeyId },
        data: { lastUsedAt: new Date() },
      });
    },
  };
}
