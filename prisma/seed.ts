import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
} else {
  dotenv.config();
}

import { PrismaClient } from '@prisma/client';

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

  console.log('Step 3: Ensuring video permissions...');
  const videoPerms = [
    { action: 'create', resource: 'video' },
    { action: 'read', resource: 'video' },
    { action: 'update', resource: 'video' },
    { action: 'delete', resource: 'video' },
  ] as const;

  const ensured: Array<{ id: string }> = [];
  for (const p of videoPerms) {
    const existing = await prisma.permission.findFirst({
      where: { action: p.action, resource: p.resource },
    });
    if (existing) {
      ensured.push(existing);
      continue;
    }
    const created = await prisma.permission.create({
      data: { action: p.action, resource: p.resource },
    });
    ensured.push(created);
  }

  const adminRole = await prisma.role.findFirst({
    where: { name: { equals: 'ADMIN', mode: 'insensitive' } },
    include: { permissions: true },
  });

  if (adminRole) {
    const existingIds = new Set(adminRole.permissions.map((p) => p.id));
    const toConnect = ensured
      .filter((p) => !existingIds.has(p.id))
      .map((p) => ({ id: p.id }));
    if (toConnect.length) {
      await prisma.role.update({
        where: { id: adminRole.id },
        data: { permissions: { connect: toConnect } },
      });
    }
  }

  const [albumCount, songCount] = await Promise.all([
    prisma.album.count(),
    prisma.song.count(),
  ]);

  if (albumCount === 0 || songCount < 5) {
    console.log('Fallback: generating minimal demo dataset...');

    const frontBase =
      process.env.FRONT_ASSET_BASE_URL || 'http://localhost:5174';
    const coverUrls = [
      `${frontBase}/thumbnails/eyango.webp`,
      `${frontBase}/thumbnails/jovi.webp`,
      `${frontBase}/thumbnails/locko.webp`,
      `${frontBase}/thumbnails/reniss.webp`,
    ];
    const audioUrls = [
      `${frontBase}/music/Blanche_Bailly.mp3`,
      `${frontBase}/music/KRYS_M.mp3`,
      `${frontBase}/music/Magasco.mp3`,
      `${frontBase}/music/Mentalite_Africaine.mp3`,
      `${frontBase}/music/NDUTU.mp3`,
      `${frontBase}/music/Tourbillon.mp3`,
    ];

    let genres = await prisma.genre.findMany({ take: 5 });
    if (genres.length === 0) {
      const genreNames = ['Afro', 'Pop', 'Rap', 'Gospel', 'Makossa'];
      for (const name of genreNames) {
        await prisma.genre.create({ data: { name, isSystem: true } });
      }
      genres = await prisma.genre.findMany({ take: 5 });
    }

    const artistNames = [
      'Pyramid Artist 1',
      'Pyramid Artist 2',
      'Pyramid Artist 3',
    ];
    const artists: Array<{ id: string }> = [];
    for (const name of artistNames) {
      const created = await prisma.artist.create({ data: { name } });
      artists.push({ id: created.id });
    }

    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i];
      const album = await prisma.album.create({
        data: {
          title: `Album ${i + 1}`,
          year: 2025,
          coverUrl: coverUrls[i % coverUrls.length],
          artistId: artist.id,
        },
      });

      for (let s = 0; s < 6; s++) {
        const genre = genres[(i + s) % genres.length];
        await prisma.song.create({
          data: {
            title: `Titre ${i + 1}-${s + 1}`,
            duration: 180 + s * 10,
            coverUrl: coverUrls[(i + s) % coverUrls.length],
            audioUrl: audioUrls[(i + s) % audioUrls.length],
            albumId: album.id,
            genreId: genre.id,
            artists: { connect: [{ id: artist.id }] },
          },
        });
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
