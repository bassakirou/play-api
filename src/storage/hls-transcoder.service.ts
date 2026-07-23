import { Injectable, Logger } from '@nestjs/common';
import { MinioService } from './minio.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { Buffer } from 'buffer';

const execAsync = promisify(exec);

@Injectable()
export class HlsTranscoderService {
  private readonly logger = new Logger(HlsTranscoderService.name);

  constructor(private readonly minio: MinioService) {}

  /**
   * Transcodes an audio file to HLS (.m3u8 + .ts segments) and uploads to MinIO.
   * Returns the public playlist URL.
   */
  async transcodeAudioAndUpload(opts: {
    inputPath: string;
    mediaId?: string;
  }): Promise<string> {
    const mediaId = opts.mediaId || randomBytes(8).toString('hex');
    const tempDir = join(process.cwd(), 'uploads', 'temp_hls', mediaId);

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const playlistPath = join(tempDir, 'playlist.m3u8');
    const segmentPattern = join(tempDir, 'segment_%03d.ts');

    // FFmpeg command for audio HLS (AAC, 192k bitrate, 6s segments)
    const command = `ffmpeg -y -i "${opts.inputPath}" -c:a aac -b:a 192k -hls_time 6 -hls_playlist_type vod -hls_segment_filename "${segmentPattern}" "${playlistPath}"`;

    try {
      this.logger.log(`Starting audio HLS transcoding for media ${mediaId}...`);
      await execAsync(command);

      // Read all generated HLS files (playlist + segments)
      const files = readdirSync(tempDir);
      this.logger.log(`Transcoding complete. Uploading ${files.length} HLS files to MinIO...`);

      const publicBaseUrl = process.env.MINIO_PUBLIC_URL || 'https://media.pyramidplay.cm';

      for (const file of files) {
        const filePath = join(tempDir, file);
        const buffer = readFileSync(filePath);
        const objectName = `hls/${mediaId}/${file}`;
        const contentType = file.endsWith('.m3u8')
          ? 'application/x-mpegURL'
          : 'video/mp2t';

        await this.minio.upload({
          bucket: 'audio',
          objectName,
          buffer,
          contentType,
        });
      }

      // Cleanup local temp directory
      rmSync(tempDir, { recursive: true, force: true });

      const playlistUrl = `${publicBaseUrl}/play-audio/hls/${mediaId}/playlist.m3u8`;
      this.logger.log(`HLS Audio stream available at: ${playlistUrl}`);
      return playlistUrl;
    } catch (err: any) {
      this.logger.error(`Audio HLS Transcoding failed: ${err.message}`, err.stack);
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      throw err;
    }
  }

  /**
   * Transcodes a video file to HLS (.m3u8 + .ts segments) and uploads to MinIO.
   * Returns the public playlist URL.
   */
  async transcodeVideoAndUpload(opts: {
    inputPath: string;
    mediaId?: string;
  }): Promise<string> {
    const mediaId = opts.mediaId || randomBytes(8).toString('hex');
    const tempDir = join(process.cwd(), 'uploads', 'temp_hls', mediaId);

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const playlistPath = join(tempDir, 'playlist.m3u8');
    const segmentPattern = join(tempDir, 'segment_%03d.ts');

    // FFmpeg command for video HLS (H.264/AAC, 6s segments)
    const command = `ffmpeg -y -i "${opts.inputPath}" -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 128k -hls_time 6 -hls_playlist_type vod -hls_segment_filename "${segmentPattern}" "${playlistPath}"`;

    try {
      this.logger.log(`Starting video HLS transcoding for media ${mediaId}...`);
      await execAsync(command);

      const files = readdirSync(tempDir);
      this.logger.log(`Transcoding complete. Uploading ${files.length} HLS files to MinIO...`);

      const publicBaseUrl = process.env.MINIO_PUBLIC_URL || 'https://media.pyramidplay.cm';

      for (const file of files) {
        const filePath = join(tempDir, file);
        const buffer = readFileSync(filePath);
        const objectName = `hls/${mediaId}/${file}`;
        const contentType = file.endsWith('.m3u8')
          ? 'application/x-mpegURL'
          : 'video/mp2t';

        await this.minio.upload({
          bucket: 'videos',
          objectName,
          buffer,
          contentType,
        });
      }

      rmSync(tempDir, { recursive: true, force: true });

      const playlistUrl = `${publicBaseUrl}/play-videos/hls/${mediaId}/playlist.m3u8`;
      this.logger.log(`HLS Video stream available at: ${playlistUrl}`);
      return playlistUrl;
    } catch (err: any) {
      this.logger.error(`Video HLS Transcoding failed: ${err.message}`, err.stack);
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      throw err;
    }
  }
}
