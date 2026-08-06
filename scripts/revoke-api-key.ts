import { prisma } from "../src/lib/prisma.js";

async function main() {
  const apiKeyId = process.argv[2];

  if (!apiKeyId) {
    console.error("Usage: npm run api-key:revoke -- <apiKeyId>");
    process.exitCode = 1;
    return;
  }

  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { revokedAt: new Date() },
  });

  console.log(`Revoked API key ${apiKeyId}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
