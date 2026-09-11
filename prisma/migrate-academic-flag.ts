import * as path from 'path';
import * as fs from 'fs';

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

const envLocalPath = path.resolve(__dirname, '../.env.local');
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envLocalPath)) {
  loadEnvFile(envLocalPath);
} else {
  loadEnvFile(envPath);
}

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Migration & Ajout de la colonne isAcademic sur Song, Album, Video, LiveStream ===');

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "isAcademic" BOOLEAN NOT NULL DEFAULT false;
    `);
    console.log('✓ Colonne isAcademic vérifiée/ajoutée sur "Song"');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Album" ADD COLUMN IF NOT EXISTS "isAcademic" BOOLEAN NOT NULL DEFAULT false;
    `);
    console.log('✓ Colonne isAcademic vérifiée/ajoutée sur "Album"');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "isAcademic" BOOLEAN NOT NULL DEFAULT false;
    `);
    console.log('✓ Colonne isAcademic vérifiée/ajoutée sur "Video"');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "LiveStream" ADD COLUMN IF NOT EXISTS "isAcademic" BOOLEAN NOT NULL DEFAULT false;
    `);
    console.log('✓ Colonne isAcademic vérifiée/ajoutée sur "LiveStream"');

    console.log('=== Migration terminée avec succès ! ===');
  } catch (err) {
    console.error('Erreur lors de la migration:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
