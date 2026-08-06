// Admin CLI: provisions a new tenant Account. Deliberately not an HTTP
// endpoint — self-registration would let anyone consume the shared Google
// service account's Drive quota (see M3), so accounts are operator-managed.
import { loadEnv } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  loadEnv();
  const name = process.argv[2];

  if (!name) {
    console.error('Usage: npm run account:create -- "Account Name"');
    process.exitCode = 1;
    return;
  }

  const account = await prisma.account.create({ data: { name } });
  console.log(`Created account ${account.id} (${account.name})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
