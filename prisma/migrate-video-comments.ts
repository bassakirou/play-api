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
  console.log('=== Migration & Création de la table VideoComment (multi-niveaux) ===');

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "VideoComment" (
        "id" TEXT NOT NULL,
        "videoId" TEXT NOT NULL,
        "userId" TEXT,
        "userName" TEXT NOT NULL,
        "userAvatar" TEXT,
        "content" TEXT NOT NULL,
        "likes" INTEGER NOT NULL DEFAULT 0,
        "isCreator" BOOLEAN NOT NULL DEFAULT false,
        "channelName" TEXT,
        "channelAvatar" TEXT,
        "parentId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "VideoComment_pkey" PRIMARY KEY ("id")
      );
    `);
    console.log('✓ Table "VideoComment" vérifiée/créée');

    // Clés étrangères
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'VideoComment_videoId_fkey'
        ) THEN
          ALTER TABLE "VideoComment"
          ADD CONSTRAINT "VideoComment_videoId_fkey"
          FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'VideoComment_userId_fkey'
        ) THEN
          ALTER TABLE "VideoComment"
          ADD CONSTRAINT "VideoComment_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'VideoComment_parentId_fkey'
        ) THEN
          ALTER TABLE "VideoComment"
          ADD CONSTRAINT "VideoComment_parentId_fkey"
          FOREIGN KEY ("parentId") REFERENCES "VideoComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    console.log('✓ Clés étrangères (Video, User, self-parent) vérifiées/ajoutées');

    // Index
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "VideoComment_videoId_createdAt_idx" ON "VideoComment"("videoId", "createdAt");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "VideoComment_parentId_idx" ON "VideoComment"("parentId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "VideoComment_userId_idx" ON "VideoComment"("userId");
    `);
    console.log('✓ Index sur VideoComment vérifiés/créés');

    console.log('=== Migration VideoComment terminée avec succès ===');
  } catch (error) {
    console.error('Erreur lors de la migration VideoComment :', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
