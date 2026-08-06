// Admin CLI: issues a new API key for an existing account. The raw key is
// printed exactly once here and never stored — only its HMAC hash is.
import { generateApiKey, hashApiKey } from "../src/auth/apiKeyCrypto.js";
import { loadEnv } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const env = loadEnv();
  const [accountId, name] = process.argv.slice(2);

  if (!accountId || !name) {
    console.error('Usage: npm run api-key:issue -- <accountId> "key name"');
    process.exitCode = 1;
    return;
  }

  const { rawKey, keyPrefix } = generateApiKey();
  const hashedKey = hashApiKey(rawKey, env.API_KEY_PEPPER);

  await prisma.apiKey.create({
    data: { accountId, name, hashedKey, keyPrefix },
  });

  console.log("API key issued — store it now, it will not be shown again:");
  console.log(rawKey);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
