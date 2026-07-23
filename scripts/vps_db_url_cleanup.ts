import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config({ path: join(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== CLEANING LOCALHOST URLS IN DATABASE ===');
  
  const songAudio = await prisma.$executeRawUnsafe(
    `UPDATE "Song" SET "audioUrl" = REPLACE("audioUrl", 'http://localhost:9000', 'https://media.pyramidplay.cm') WHERE "audioUrl" LIKE '%localhost:9000%';`
  );
  console.log('Song.audioUrl updated:', songAudio);

  const songCover = await prisma.$executeRawUnsafe(
    `UPDATE "Song" SET "coverUrl" = REPLACE("coverUrl", 'http://localhost:9000', 'https://media.pyramidplay.cm') WHERE "coverUrl" LIKE '%localhost:9000%';`
  );
  console.log('Song.coverUrl updated:', songCover);

  const artistImg = await prisma.$executeRawUnsafe(
    `UPDATE "Artist" SET "imageUrl" = REPLACE("imageUrl", 'http://localhost:9000', 'https://media.pyramidplay.cm') WHERE "imageUrl" LIKE '%localhost:9000%';`
  );
  console.log('Artist.imageUrl updated:', artistImg);

  const artistBanner = await prisma.$executeRawUnsafe(
    `UPDATE "Artist" SET "bannerUrl" = REPLACE("bannerUrl", 'http://localhost:9000', 'https://media.pyramidplay.cm') WHERE "bannerUrl" LIKE '%localhost:9000%';`
  );
  console.log('Artist.bannerUrl updated:', artistBanner);

  const artistGallery = await prisma.$executeRawUnsafe(
    `UPDATE "Artist" SET "gallery" = REPLACE("gallery", 'http://localhost:9000', 'https://media.pyramidplay.cm') WHERE "gallery" LIKE '%localhost:9000%';`
  );
  console.log('Artist.gallery updated:', artistGallery);

  const albumCover = await prisma.$executeRawUnsafe(
    `UPDATE "Album" SET "coverUrl" = REPLACE("coverUrl", 'http://localhost:9000', 'https://media.pyramidplay.cm') WHERE "coverUrl" LIKE '%localhost:9000%';`
  );
  console.log('Album.coverUrl updated:', albumCover);

  const videoUrl = await prisma.$executeRawUnsafe(
    `UPDATE "Video" SET "videoUrl" = REPLACE("videoUrl", 'http://localhost:9000', 'https://media.pyramidplay.cm') WHERE "videoUrl" LIKE '%localhost:9000%';`
  );
  console.log('Video.videoUrl updated:', videoUrl);

  const videoThumb = await prisma.$executeRawUnsafe(
    `UPDATE "Video" SET "thumbnailUrl" = REPLACE("thumbnailUrl", 'http://localhost:9000', 'https://media.pyramidplay.cm') WHERE "thumbnailUrl" LIKE '%localhost:9000%';`
  );
  console.log('Video.thumbnailUrl updated:', videoThumb);

  console.log('=== DATABASE URL CLEANUP COMPLETE ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
