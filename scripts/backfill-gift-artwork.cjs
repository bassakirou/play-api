const { readFileSync, existsSync } = require('node:fs');
const { basename, resolve } = require('node:path');
const { parse } = require('dotenv');
const { Prisma, PrismaClient } = require('@prisma/client');
const artwork = require('../src/monetization/default-gift-artwork.json');

async function main() {
  const production = process.argv.includes('--production');
  const envFile = resolve(__dirname, production ? '../.env' : '../.env.local');
  const { DATABASE_URL: databaseUrl } = parse(readFileSync(envFile));
  if (!databaseUrl) throw new Error('DATABASE_URL is missing from the selected environment file.');
  if (!production && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
    throw new Error('Local mode requires a local PostgreSQL connection.');
  }

  for (const { url } of Object.values(artwork)) {
    if (!existsSync(resolve(__dirname, '../../../packages/images/gifts', basename(url)))) {
      throw new Error(`Missing gift artwork ${basename(url)}.`);
    }
  }

  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const { updated, missing } = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
      const updated = [];
      for (const [name, { url, legacy }] of Object.entries(artwork)) {
        const changed = await tx.$queryRaw`
          UPDATE "GiftCatalog"
          SET "iconUrl" = ${url}, "updatedAt" = CURRENT_TIMESTAMP
          WHERE UPPER(BTRIM("name")) = ${name}
            AND ("iconUrl" IS NULL OR "iconUrl" ~ '^[[:space:]]*$'
              OR BTRIM("iconUrl") IN (${Prisma.join([...legacy, '/assets/gifts/default.svg'])}))
          RETURNING "name"
        `;
        updated.push(...changed.map((row) => row.name));
      }
      const missing = await tx.$queryRaw`
        SELECT "name" FROM "GiftCatalog"
        WHERE "iconUrl" IS NULL OR "iconUrl" ~ '^[[:space:]]*$'
          OR BTRIM("iconUrl") IN ('/assets/gifts/default.svg', '/assets/gifts/panthere.svg', '/assets/gifts/elephant.svg')
        ORDER BY "name"
      `;
      return { updated, missing };
    }, { timeout: 30000 });
    console.log(`Gift artwork updated: ${updated.length}${updated.length ? ` (${updated.join(', ')})` : ''}.`);
    if (missing.length) console.warn(`Upload artwork manually for: ${missing.map((row) => row.name).join(', ')}.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
