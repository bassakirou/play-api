import * as dotenv from 'dotenv';
import { extname, join } from 'path';
import { Buffer } from 'buffer';

dotenv.config({ path: join(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { MinioService } from '../src/storage/minio.service';
import { HlsTranscoderService } from '../src/storage/hls-transcoder.service';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();
const minio = new MinioService();
const hlsTranscoder = new HlsTranscoderService(minio);

async function runBatchHlsTranscode() {
  console.log('=== STARTING BATCH HLS TRANSCODING FOR EXISTING MEDIA ===');

  const tempFolder = join(process.cwd(), 'uploads', 'batch_hls_temp');
  if (!existsSync(tempFolder)) {
    mkdirSync(tempFolder, { recursive: true });
  }

  try {
    // 1. Transcode Songs
    const songs = await prisma.song.findMany();
    console.log(`Found ${songs.length} songs in database.`);

    let songSuccessCount = 0;

    for (const song of songs) {
      if (!song.audioUrl || song.audioUrl.endsWith('.m3u8')) {
        console.log(`[Song ${song.id}] Already HLS or missing audioUrl. Skipping.`);
        continue;
      }

      console.log(`[Song ${song.id}] Processing "${song.title}" (${song.audioUrl})...`);
      try {
        const response = await fetch(song.audioUrl, {
          headers: { Referer: 'https://pyramidplay.cm' },
        });
        if (!response.ok) {
          console.error(`[Song ${song.id}] Failed to download audio from ${song.audioUrl}: HTTP ${response.status}`);
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const urlPath = new URL(song.audioUrl).pathname;
        const ext = extname(urlPath) || '.mp3';
        const tempInputPath = join(tempFolder, `input_${song.id}${ext}`);
        writeFileSync(tempInputPath, buffer);

        // Transcode to HLS and upload to MinIO
        const hlsUrl = await hlsTranscoder.transcodeAudioAndUpload({
          inputPath: tempInputPath,
          mediaId: song.id,
        });

        // Update database
        await prisma.song.update({
          where: { id: song.id },
          data: { audioUrl: hlsUrl },
        });

        console.log(`[Song ${song.id}] SUCCESS -> Transcoded and updated to: ${hlsUrl}`);
        songSuccessCount++;

        // Clean up temp file
        if (existsSync(tempInputPath)) rmSync(tempInputPath, { force: true });
      } catch (err: any) {
        console.error(`[Song ${song.id}] Transcode error:`, err);
      }
    }

    console.log(`\n=== SONGS TRANSCODING SUMMARY ===`);
    console.log(`Successfully converted ${songSuccessCount} / ${songs.length} songs to HLS.`);

    // 2. Transcode Videos (if any Video table exists)
    try {
      const videos = await (prisma as any).video.findMany();
      console.log(`Found ${videos.length} videos in database.`);
      let videoSuccessCount = 0;

      for (const video of videos) {
        if (!video.videoUrl || video.videoUrl.endsWith('.m3u8')) {
          continue;
        }

        console.log(`[Video ${video.id}] Processing "${video.title}"...`);
        try {
          const response = await fetch(video.videoUrl, {
            headers: { Referer: 'https://pyramidplay.cm' },
          });
          if (!response.ok) continue;

          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const tempInputPath = join(tempFolder, `input_${video.id}.mp4`);
          writeFileSync(tempInputPath, buffer);

          const hlsUrl = await hlsTranscoder.transcodeVideoAndUpload({
            inputPath: tempInputPath,
            mediaId: video.id,
          });

          await (prisma as any).video.update({
            where: { id: video.id },
            data: { videoUrl: hlsUrl },
          });

          console.log(`[Video ${video.id}] SUCCESS -> ${hlsUrl}`);
          videoSuccessCount++;

          if (existsSync(tempInputPath)) rmSync(tempInputPath, { force: true });
        } catch (err: any) {
          console.error(`[Video ${video.id}] Transcode error: ${err.message}`);
        }
      }
      console.log(`Successfully converted ${videoSuccessCount} / ${videos.length} videos to HLS.`);
    } catch {
      console.log('No Video model found or video table empty.');
    }

  } finally {
    if (existsSync(tempFolder)) {
      rmSync(tempFolder, { recursive: true, force: true });
    }
    await prisma.$disconnect();
  }
}

runBatchHlsTranscode()
  .then(() => console.log('=== BATCH HLS TRANSCODING COMPLETED ==='))
  .catch((err) => console.error('Batch HLS Transcode failed:', err));
