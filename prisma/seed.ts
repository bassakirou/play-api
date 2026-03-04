import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  // 1. Roles & Permissions
  const roles = ['ADMIN', 'CREATOR', 'LABEL', 'USER'];
  for (const roleName of roles) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
  }
  console.log('Roles created.');

  // 2. Load Mock Data
  const artistsData = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../datas/mock/artist.json'), 'utf8'));
  const albumsData = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../datas/mock/album.json'), 'utf8'));
  const songsData = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../datas/mock/music.json'), 'utf8'));

  // 3. Genres
  const genresMap = new Map();
  const allGenres = new Set();
  artistsData.forEach((a: any) => a.genres?.forEach((g: any) => allGenres.add(g.name)));
  songsData.forEach((s: any) => s.genres?.forEach((g: any) => allGenres.add(g.name)));

  for (const genreName of Array.from(allGenres)) {
    const genre = await prisma.genre.upsert({
      where: { name: genreName as string },
      update: {},
      create: { name: genreName as string },
    });
    genresMap.set(genreName, genre.id);
  }
  console.log('Genres created.');

  // 4. Artists
  const artistIdMap = new Map();
  for (const a of artistsData) {
    const artist = await prisma.artist.create({
      data: {
        name: a.name,
        imageUrl: a.image,
        certified: true,
      },
    });
    artistIdMap.set(a.id, artist.id);
  }
  console.log('Artists created.');

  // 5. Albums
  const albumIdMap = new Map();
  for (const alb of albumsData) {
    const album = await prisma.album.create({
      data: {
        title: alb.title,
        year: parseInt(alb.year) || 2024,
        coverUrl: alb.cover,
        artistId: artistIdMap.get(alb.artistId),
      },
    });
    albumIdMap.set(alb.id, album.id);
  }
  console.log('Albums created.');

  // 6. Songs
  for (const s of songsData) {
    await prisma.song.create({
      data: {
        title: s.title,
        audioUrl: s.url,
        duration: s.duration || 0,
        artistId: artistIdMap.get(s.artistId),
        albumId: s.albumId ? albumIdMap.get(s.albumId) : null,
        genreId: s.genres?.[0] ? genresMap.get(s.genres[0].name) : null,
      },
    });
  }
  console.log('Songs created.');

  console.log('Seed finished successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
