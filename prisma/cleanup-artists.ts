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
  console.log('=== Nettoyage des profils artistes orphelins / erronés ===');

  const staleArtists = await prisma.artist.findMany({
    where: {
      userId: { not: null },
      user: {
        role: {
          name: { not: 'CREATOR' },
        },
      },
      songs: { none: {} },
      albums: { none: {} },
      videos: { none: {} },
      groups: { none: {} },
    },
    include: {
      user: {
        include: {
          role: true,
        },
      },
    },
  });

  console.log(`Profils artistes orphelins trouvés : ${staleArtists.length}`);

  for (const a of staleArtists) {
    console.log(
      ` -> Suppression de l'artiste: "${a.name}" (ID: ${a.id}, User: ${a.user?.email || a.userId}, Rôle: ${a.user?.role?.name || 'N/A'})`,
    );
  }

  if (staleArtists.length > 0) {
    const ids = staleArtists.map((a) => a.id);
    const result = await prisma.artist.deleteMany({
      where: { id: { in: ids } },
    });
    console.log(`✅ ${result.count} profil(s) artiste(s) orphelin(s) supprimé(s) avec succès.`);
  } else {
    console.log('✨ Aucun profil artiste orphelin à supprimer.');
  }
}

main()
  .catch((e) => {
    console.error('Erreur lors du nettoyage des artistes :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
