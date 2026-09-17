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
  console.log('=== Migration & Initialisation de la table SharePlatform ===');

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SharePlatform" (
        "id" TEXT NOT NULL,
        "key" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "icon" TEXT NOT NULL,
        "shareUrl" TEXT NOT NULL,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "order" INTEGER NOT NULL DEFAULT 0,
        "color" TEXT,
        "includeTitle" BOOLEAN NOT NULL DEFAULT true,
        "includeAuthor" BOOLEAN NOT NULL DEFAULT true,
        "includeDescription" BOOLEAN NOT NULL DEFAULT false,
        "defaultHashtags" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SharePlatform_pkey" PRIMARY KEY ("id")
      );
    `);
    console.log('✓ Table "SharePlatform" vérifiée/créée');

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "SharePlatform_key_key" ON "SharePlatform"("key");
    `);
    console.log('✓ Index unique "SharePlatform_key_key" vérifié');

    const defaultPlatforms = [
      {
        key: 'whatsapp',
        name: 'WhatsApp',
        icon: 'whatsapp',
        shareUrl: 'https://api.whatsapp.com/send?text={text}%20{url}',
        enabled: true,
        order: 1,
        color: '#25D366',
        includeTitle: true,
        includeAuthor: true,
        includeDescription: false,
        defaultHashtags: '#PyramidPlay',
      },
      {
        key: 'facebook',
        name: 'Facebook',
        icon: 'facebook',
        shareUrl: 'https://www.facebook.com/sharer/sharer.php?u={url}&quote={text}',
        enabled: true,
        order: 2,
        color: '#1877F2',
        includeTitle: true,
        includeAuthor: true,
        includeDescription: false,
        defaultHashtags: '#PyramidPlay',
      },
      {
        key: 'twitter',
        name: 'X (Twitter)',
        icon: 'twitter',
        shareUrl: 'https://twitter.com/intent/tweet?url={url}&text={text}',
        enabled: true,
        order: 3,
        color: '#000000',
        includeTitle: true,
        includeAuthor: true,
        includeDescription: false,
        defaultHashtags: '#PyramidPlay',
      },
      {
        key: 'telegram',
        name: 'Telegram',
        icon: 'telegram',
        shareUrl: 'https://t.me/share/url?url={url}&text={text}',
        enabled: true,
        order: 4,
        color: '#229ED9',
        includeTitle: true,
        includeAuthor: true,
        includeDescription: false,
        defaultHashtags: '#PyramidPlay',
      },
      {
        key: 'linkedin',
        name: 'LinkedIn',
        icon: 'linkedin',
        shareUrl: 'https://www.linkedin.com/sharing/share-offsite/?url={url}',
        enabled: true,
        order: 5,
        color: '#0A66C2',
        includeTitle: true,
        includeAuthor: true,
        includeDescription: true,
        defaultHashtags: '#PyramidPlay',
      },
      {
        key: 'email',
        name: 'Email',
        icon: 'mail',
        shareUrl: 'mailto:?subject={title}&body={text}%0A%0A{url}',
        enabled: true,
        order: 6,
        color: '#EA4335',
        includeTitle: true,
        includeAuthor: true,
        includeDescription: true,
        defaultHashtags: null,
      },
    ];

    for (const p of defaultPlatforms) {
      const hashtagsVal = p.defaultHashtags ? `'${p.defaultHashtags}'` : 'NULL';
      await prisma.$executeRawUnsafe(`
        INSERT INTO "SharePlatform" ("id", "key", "name", "icon", "shareUrl", "enabled", "order", "color", "includeTitle", "includeAuthor", "includeDescription", "defaultHashtags", "createdAt", "updatedAt")
        VALUES (
          gen_random_uuid()::text,
          '${p.key}',
          '${p.name}',
          '${p.icon}',
          '${p.shareUrl}',
          ${p.enabled},
          ${p.order},
          '${p.color}',
          ${p.includeTitle},
          ${p.includeAuthor},
          ${p.includeDescription},
          ${hashtagsVal},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("key") DO NOTHING;
      `);
    }
    console.log('✓ Plateformes par défaut insérées avec succès');

    console.log('=== Migration SharePlatform terminée avec succès ! ===');
  } catch (error) {
    console.error('Erreur lors de la migration SharePlatform:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
