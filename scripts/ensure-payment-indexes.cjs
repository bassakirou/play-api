// Prepare additive unique indexes without allowing Prisma to discard data.
const { resolve } = require('node:path');
const production = process.argv.includes('--production');
require('dotenv').config({ path: resolve(__dirname, production ? '../.env' : '../.env.local'), override: true, quiet: true });
if (!production && !['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Local database required');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
    const tables = await tx.$queryRawUnsafe(`SELECT to_regclass('public."Transaction"')::text AS transactions, to_regclass('public."UserSubscription"')::text AS subscriptions`);
    if (tables[0].transactions) {
      const duplicates = await tx.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM (SELECT "productId" FROM "Transaction" WHERE "productId" IS NOT NULL GROUP BY "productId" HAVING COUNT(*) > 1) duplicates');
      if (duplicates[0].count) throw new Error('Duplicate payment references require review; no data was removed.');
      await tx.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_productId_key" ON "Transaction" ("productId")');
    }
    if (tables[0].subscriptions) {
      await tx.$executeRawUnsafe('ALTER TABLE "UserSubscription" ADD COLUMN IF NOT EXISTS "transactionId" TEXT');
      const duplicates = await tx.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM (SELECT "transactionId" FROM "UserSubscription" WHERE "transactionId" IS NOT NULL GROUP BY "transactionId" HAVING COUNT(*) > 1) duplicates');
      if (duplicates[0].count) throw new Error('Duplicate subscription references require review; no data was removed.');
      await tx.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "UserSubscription_transactionId_key" ON "UserSubscription" ("transactionId")');
    }
  }, { timeout: 60000 });
  console.log('Payment uniqueness verified; additive indexes ready. No records deleted.');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
