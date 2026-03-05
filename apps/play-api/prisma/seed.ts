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
  try {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "User", "Artist", "Album", "Song", "Genre", "Role", "Permission", "Playlist", "_ArtistGroupMembers", "_PermissionToRole", "_PlaylistSongs", "_SongArtists", "_SongGroups", "_UserFavorites", "_UserFollowsArtist" RESTART IDENTITY CASCADE;',
    );
    console.log('Truncate successful.');
  } catch (e) {
    console.warn(
      'Truncate failed (tables might be empty or missing):',
      e.message,
    );
  }

  console.log('Step 2: Importing local data from backup.sql...');

  const lines = sql.split('\n');
  let currentTable = '';
  let isCopying = false;
  let columns: string[] = [];
  let rowCount = 0;

  for (const line of lines) {
    if (line.startsWith('COPY public."')) {
      const match = line.match(/COPY public\."(\w+)" \((.+)\) FROM stdin/);
      if (match) {
        currentTable = match[1];
        columns = match[2].split(', ').map((c) => c.replace(/"/g, '').trim());
        isCopying = true;
        rowCount = 0;
        console.log(`Importing table: ${currentTable}...`);
        continue;
      }
    }

    if (line.trim() === '\\.') {
      if (isCopying)
        console.log(`Finished ${currentTable} (${rowCount} rows).`);
      isCopying = false;
      currentTable = '';
      continue;
    }

    if (isCopying && line.trim() !== '') {
      const values = line.split('\t').map((v) => {
        const val = v.trim();
        if (val === '\\N' || val === '') return 'NULL';
        // Échapper les quotes pour le SQL
        const escaped = val.replace(/'/g, "''");
        return `'${escaped}'`;
      });

      if (values.length !== columns.length) {
        // Parfois les colonnes avec du texte contenant des tabulations peuvent poser problème
        continue;
      }

      const query = `INSERT INTO public."${currentTable}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;`;
      try {
        await prisma.$executeRawUnsafe(query);
        rowCount++;
      } catch (e) {
        // Log discret pour ne pas saturer la console Vercel
        if (rowCount < 5)
          console.error(`Insert failed in ${currentTable}:`, e.message);
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
