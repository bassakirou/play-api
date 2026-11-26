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

// Only the five videos identified in the owner's confirmation.
const videoIds = [
  'b1ef4552-d35f-4f62-b051-b66cfd6ce530',
  '50b16aec-73bf-4619-83e0-c7e0d0753ad3',
  'b33c2808-44eb-4a8f-a977-5f7d4fd191ad',
  '1545aaee-77e6-476b-a4b4-d027b2617da0',
  'fc1bc2b4-c63e-4afb-b758-4952b8446023',
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
    const updates = await db.$transaction(async (tx) => {
      const jobs = [
        { label: 'Audiobook', model: tx.audiobook, ids: bookIds },
        { label: 'Video', model: tx.video, ids: videoIds },
      ].map(({ label, model, ids }) => ({
        label,
        model,
        where: { id: { in: ids }, publisherId: null },
      }));

      const pending = [];
      for (const job of jobs) {
        if (await job.model.count({ where: job.where })) pending.push(job);
      }
      if (!pending.length) return [];

      const account = await tx.user.findUnique({
        where: { email: publisherEmail },
        select: { id: true },
      });
      if (!account) throw new Error('Confirmed publisher account was not found.');

      const results = [];
      for (const { label, model, where } of pending) {
        const result = await model.updateMany({ where, data: { publisherId: account.id } });
        results.push({ label, count: result.count });
      }
      return results;
    });
    for (const { label, count } of updates) console.log(`${label} publishers assigned: ${count}.`);
    if (!updates.length) console.log('No confirmed publishers needed assignment.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
