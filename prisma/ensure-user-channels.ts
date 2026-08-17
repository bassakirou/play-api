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
  console.log('=== Initialisation des chaînes par défaut pour les utilisateurs ===');

  const users = await prisma.user.findMany({
    include: {
      artistProfile: true,
      role: true,
    },
  });

  console.log(`Nombre total d'utilisateurs trouvés : ${users.length}`);

  let createdCount = 0;
  for (const user of users) {
    if (!user.artistProfile) {
      const channelName = (user.name || user.email.split('@')[0] || 'Chaîne').trim();
      const channel = await prisma.artist.create({
        data: {
          name: channelName,
          userId: user.id,
        },
      });
      console.log(`[+] Chaîne créée pour ${user.email} (${user.role.name}) : "${channel.name}" (ID: ${channel.id})`);
      createdCount++;
    } else {
      console.log(`[OK] Chaîne existante pour ${user.email} : "${user.artistProfile.name}"`);
    }
  }

  console.log(`=== Terminé : ${createdCount} nouvelle(s) chaîne(s) créée(s) ===`);
}

main()
  .catch((e) => {
    console.error('Erreur lors de l\'initialisation des chaînes:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
