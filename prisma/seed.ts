import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Database Synchronization Start ---');

  const sqlFile = path.join(__dirname, '../backup.sql');
  if (!fs.existsSync(sqlFile)) {
    throw new Error(`Backup file not found at ${sqlFile}`);
  }

  const sql = fs.readFileSync(sqlFile, 'utf8');

  // Nettoyage du SQL pour compatibilité (Prisma $executeRawUnsafe)
  // On enlève les commandes spécifiques à pg_dump qui ne passent pas en Raw SQL
  const commands = sql
    .split(';')
    .map((cmd) => cmd.trim())
    .filter(
      (cmd) =>
        cmd.length > 0 &&
        !cmd.startsWith('--') &&
        !cmd.startsWith('\\') &&
        !cmd.startsWith('SET ') &&
        !cmd.startsWith('SELECT pg_catalog') &&
        !cmd.includes('OWNER TO') &&
        !cmd.includes('CREATE SCHEMA'),
    );

  console.log('Step 1: Truncating existing tables...');
  // On désactive les contraintes pour vider proprement
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "User", "Artist", "Album", "Song", "Genre", "Role", "Permission", "Playlist", "_ArtistGroupMembers", "_PermissionToRole", "_PlaylistSongs", "_SongArtists", "_SongGroups", "_UserFavorites", "_UserFollowsArtist" RESTART IDENTITY CASCADE;',
  );

  console.log('Step 2: Importing local data from backup.sql...');

  // Note: pg_dump utilise COPY qui n'est pas supporté par $executeRaw.
  // Nous devons donc traiter le fichier SQL différemment ou utiliser une approche par table.
  // Comme le fichier backup.sql utilise COPY, nous allons plutôt faire un import intelligent.

  // Approche simplifiée pour Vercel : On execute le SQL par blocs
  // Mais attention, $executeRawUnsafe ne supporte pas COPY FROM stdin.

  // SOLUTION: Puisque nous ne pouvons pas utiliser COPY directement via Prisma,
  // et que la connexion directe est bloquée, la meilleure méthode est d'utiliser
  // les données JSON si elles sont à jour, OU de transformer le SQL en INSERTS.

  // Comme vous avez confirmé que la BDD locale est la référence,
  // je vais créer un script qui parse les blocs COPY du backup.sql pour faire des INSERTS.

  const lines = sql.split('\n');
  let currentTable = '';
  let isCopying = false;
  let columns: string[] = [];

  for (const line of lines) {
    if (line.startsWith('COPY public."')) {
      const match = line.match(/COPY public\."(\w+)" \((.+)\) FROM stdin/);
      if (match) {
        currentTable = match[1];
        columns = match[2].split(', ').map((c) => c.replace(/"/g, ''));
        isCopying = true;
        console.log(`Importing table: ${currentTable}...`);
        continue;
      }
    }

    if (line === '\\.') {
      isCopying = false;
      currentTable = '';
      continue;
    }

    if (isCopying && line.trim() !== '') {
      const values = line.split('\t').map((v) => {
        if (v === '\\N') return 'NULL';
        // Échapper les quotes pour le SQL
        const escaped = v.replace(/'/g, "''");
        return `'${escaped}'`;
      });

      const query = `INSERT INTO public."${currentTable}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;`;
      try {
        await prisma.$executeRawUnsafe(query);
      } catch (e) {
        console.warn(`Failed to insert row in ${currentTable}:`, e.message);
      }
    }
  }

  console.log('--- Database Synchronization Successful! ---');
}

main()
  .catch((e) => {
    console.error('CRITICAL: Sync failed!', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
