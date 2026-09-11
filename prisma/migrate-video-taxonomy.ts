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
  console.log('=== Migration & Synchronisation des Catégories et Tags Vidéo ===');

  try {
    // 1. Migrate Video Categories
    await prisma.$executeRawUnsafe(`
      INSERT INTO "VideoCategory" ("id", "name", "normalizedName", "updatedAt")
      SELECT md5(random()::text || clock_timestamp()::text)::uuid, MIN("category"), LOWER(TRIM("category")), CURRENT_TIMESTAMP
      FROM "Video"
      WHERE "category" IS NOT NULL AND TRIM("category") <> ''
      GROUP BY LOWER(TRIM("category"))
      ON CONFLICT ("normalizedName") DO NOTHING;
    `);

    // 2. Link Videos to VideoCategory
    await prisma.$executeRawUnsafe(`
      UPDATE "Video" AS v SET "categoryId" = c."id"
      FROM "VideoCategory" AS c
      WHERE v."category" IS NOT NULL AND LOWER(TRIM(v."category")) = c."normalizedName" AND (v."categoryId" IS NULL OR v."categoryId" <> c."id");
    `);

    // 3. Migrate Video Tags
    await prisma.$executeRawUnsafe(`
      INSERT INTO "VideoTag" ("id", "name", "normalizedName", "createdAt", "updatedAt")
      SELECT md5(random()::text || clock_timestamp()::text)::uuid, MIN(tag), LOWER(TRIM(tag)), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM "Video" v, unnest(v."tags") AS tag
      WHERE TRIM(tag) <> ''
      GROUP BY LOWER(TRIM(tag))
      ON CONFLICT ("normalizedName") DO NOTHING;
    `);

    // 4. Link Videos to VideoTags via VideoTagOnVideo
    await prisma.$executeRawUnsafe(`
      INSERT INTO "VideoTagOnVideo" ("videoId", "tagId")
      SELECT v."id", t."id"
      FROM "Video" v, unnest(v."tags") AS tag
      JOIN "VideoTag" t ON t."normalizedName" = LOWER(TRIM(tag))
      WHERE TRIM(tag) <> ''
      ON CONFLICT DO NOTHING;
    `);

    const catCount = await (prisma as any).videoCategory.count();
    const tagCount = await (prisma as any).videoTag.count();
    const linkCount = await (prisma as any).videoTagOnVideo.count();

    console.log(`[OK] Catégories synchronisées : ${catCount}`);
    console.log(`[OK] Tags synchronisés : ${tagCount}`);
    console.log(`[OK] Associations Vidéo-Tags : ${linkCount}`);
    console.log('=== Migration de la taxonomie vidéo terminée avec succès ===');
  } catch (err: any) {
    console.warn(`[WARN] Erreur lors de la synchronisation de la taxonomie vidéo: ${err.message}`);
  }
}

main()
  .catch((e) => {
    console.error('Erreur inattendue:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
