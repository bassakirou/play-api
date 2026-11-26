const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parse } = require('dotenv');
const { PrismaClient } = require('@prisma/client');

const publisherEmail = 'pyramidplay@pymail.cm';
// Production catalog explicitly confirmed by the owner on 26 November 2026.
const bookIds = [
  '2ff842a7-31bd-4049-b5e2-3ee69f7eba2e',
  'faec55ae-be26-48e9-a12f-b9c1dfdb3670',
  '754d8a28-edc3-4a8f-8b43-611d9ffff9e5',
  'd73198d6-0e29-4670-9d2a-ea593fd78b01',
  'b854fbd2-6a2c-413d-bce2-6d6e462273be',
  'ca7afe05-ce5e-4e44-9f05-627b1ff6bd75',
  '1795a014-3e11-4263-9219-4b79e1c5d127',
  '243ed96e-307a-44b9-bcb5-8d4a95c90f3d',
  'dae6a875-3104-4876-a242-867d8ecfe94f',
  '0cb3ded7-8cb8-49c9-8fdd-703f0c5a9d3b',
  '77d47f07-54a0-415a-b846-01f79248371f',
];

async function main() {
  const production = process.argv.includes('--production');
  const envFile = resolve(__dirname, production ? '../.env' : '../.env.local');
  const { DATABASE_URL: databaseUrl } = parse(readFileSync(envFile));
  if (!databaseUrl) throw new Error('DATABASE_URL is missing from the selected environment file.');
  if (!production && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
    throw new Error('Local mode requires a local PostgreSQL connection.');
  }

  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const count = await db.$transaction(async (tx) => {
      const where = { id: { in: bookIds }, publisherId: null };
      if (await tx.audiobook.count({ where }) === 0) return 0;

      const account = await tx.user.findUnique({
        where: { email: publisherEmail },
        select: { id: true },
      });
      if (!account) throw new Error('Confirmed audiobook publisher account was not found.');

      const result = await tx.audiobook.updateMany({ where, data: { publisherId: account.id } });
      return result.count;
    });
    console.log(`Audiobook publishers assigned: ${count}.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
