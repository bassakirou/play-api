import { Injectable, Logger } from '@nestjs/common';
import { MinioService } from './minio.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const execAsync = promisify(exec);

export type QualityTier = '1080p' | '720p' | '480p' | '360p';

export interface VideoAnalysisResult {
  width: number;
  height: number;
  duration: number;
  formattedDuration: string;
  maxQuality: QualityTier;
  maxQualityLabel: string;
  allowedQualities: QualityTier[];
}

export interface QualityVariantConfig {
  quality: QualityTier;
  label: string;
  width: number;
  height: number;
  videoBitrate: string;
  maxRate: string;
  bufSize: string;
  audioBitrate: string;
  bandwidth: number;
}

export const QUALITY_PRESETS: Record<QualityTier, QualityVariantConfig> = {
  '1080p': {
    quality: '1080p',
    label: 'Full HD (1080p)',
    width: 1920,
    height: 1080,
    videoBitrate: '4500k',
    maxRate: '4900k',
    bufSize: '9000k',
    audioBitrate: '192k',
    bandwidth: 4800000,
  },
  '720p': {
    quality: '720p',
    label: 'HD (720p)',
    width: 1280,
    height: 720,
    videoBitrate: '2500k',
    maxRate: '2800k',
    bufSize: '5000k',
    audioBitrate: '128k',
    bandwidth: 2700000,
  },
  '480p': {
    quality: '480p',
    label: 'Standard (480p)',
    width: 854,
    height: 480,
    videoBitrate: '1200k',
    maxRate: '1400k',
    bufSize: '2400k',
    audioBitrate: '96k',
    bandwidth: 1350000,
  },
  '360p': {
    quality: '360p',
    label: 'Basse (360p)',
    width: 640,
    height: 360,
    videoBitrate: '600k',
    maxRate: '700k',
    bufSize: '1200k',
    audioBitrate: '64k',
    bandwidth: 700000,
  },
};

function formatSeconds(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

@Injectable()
export class HlsTranscoderService {
  private readonly logger = new Logger(HlsTranscoderService.name);

  constructor(private readonly minio: MinioService) {}

  /**
   * Probes video metadata with ffprobe
   */
  async analyzeVideo(inputPath: string): Promise<VideoAnalysisResult> {
    const ffprobeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -show_entries format=duration -of json "${inputPath}"`;
    try {
      const { stdout } = await execAsync(ffprobeCmd);
      const data = JSON.parse(stdout || '{}');
      const stream = data.streams?.[0] || {};
      const format = data.format || {};

      const width = Number(stream.width) || 1280;
      const height = Number(stream.height) || 720;
      const duration = Math.round(Number(stream.duration || format.duration || 0));

      let maxQuality: QualityTier = '360p';
      let maxQualityLabel = '360P';
      const allowedQualities: QualityTier[] = ['360p'];

      if (height >= 1080 || width >= 1920) {
        maxQuality = '1080p';
        maxQualityLabel = '1080P';
        allowedQualities.unshift('480p', '720p', '1080p');
      } else if (height >= 720 || width >= 1280) {
        maxQuality = '720p';
        maxQualityLabel = '720P';
        allowedQualities.unshift('480p', '720p');
      } else if (height >= 480 || width >= 854) {
        maxQuality = '480p';
        maxQualityLabel = '480P';
        allowedQualities.unshift('480p');
      }

      return {
        width,
        height,
        duration,
        formattedDuration: formatSeconds(duration),
        maxQuality,
        maxQualityLabel,
        allowedQualities: Array.from(new Set(allowedQualities)),
      };
    } catch (err: any) {
      this.logger.warn(`ffprobe failed on ${inputPath}: ${err.message}. Using default 720p analysis.`);
      return {
        width: 1280,
        height: 720,
        duration: 0,
        formattedDuration: '00:00',
        maxQuality: '720p',
        maxQualityLabel: '720P',
        allowedQualities: ['1080p', '720p', '480p', '360p'],
      };
    }
  }

  /**
   * Transcodes an audio file to HLS (.m3u8 + .ts segments) and uploads to MinIO.
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

    const command = `ffmpeg -y -i "${opts.inputPath}" -c:a aac -b:a 192k -hls_time 6 -hls_playlist_type vod -hls_segment_filename "${segmentPattern}" "${playlistPath}"`;

    try {
      this.logger.log(`Starting audio HLS transcoding for media ${mediaId}...`);
      await execAsync(command);

      const files = readdirSync(tempDir);
      this.logger.log(`Transcoding complete. Uploading ${files.length} HLS files to MinIO...`);

      const publicBaseUrl = process.env.MINIO_PUBLIC_URL || 'http://localhost:9000';

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
   * Transcodes a video into multiple quality variants (1080p, 720p, 480p, 360p)
   * strictly constrained by the source resolution.
   * Generates master.m3u8 playlist and uploads all variant playlists & segments to MinIO.
   */
  async generateVideoVariants(opts: {
    inputPath: string;
    mediaId?: string;
    targetQualities?: QualityTier[];
  }): Promise<{
    masterUrl: string;
    variants: Partial<Record<QualityTier, string>>;
    analysis: VideoAnalysisResult;
  }> {
    const mediaId = opts.mediaId || randomBytes(8).toString('hex');
    const tempDir = join(process.cwd(), 'uploads', 'temp_hls_video', mediaId);

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const analysis = await this.analyzeVideo(opts.inputPath);
    this.logger.log(`Video analysis for ${mediaId}: ${analysis.width}x${analysis.height}, max allowed: ${analysis.maxQuality}`);

    // Filter requested qualities so we NEVER upscale above the source resolution
    const requested = opts.targetQualities && opts.targetQualities.length > 0
      ? opts.targetQualities
      : (['1080p', '720p', '480p', '360p'] as QualityTier[]);

    const validQualities = requested.filter((q) => analysis.allowedQualities.includes(q));

    if (validQualities.length === 0) {
      validQualities.push('360p');
    }

    this.logger.log(`Generating ${validQualities.length} HLS quality tiers for media ${mediaId}: ${validQualities.join(', ')}`);

    const publicBaseUrl =
      process.env.MINIO_PUBLIC_URL ||
      (process.env.NODE_ENV === 'production' || !!process.env.VERCEL
        ? 'https://media.pyramidplay.cm'
        : 'http://localhost:9000');
    const variantUrls: Partial<Record<QualityTier, string>> = {};

    try {
      for (const quality of validQualities) {
        const preset = QUALITY_PRESETS[quality];
        const qualityDir = join(tempDir, quality);
        if (!existsSync(qualityDir)) {
          mkdirSync(qualityDir, { recursive: true });
        }

        const playlistPath = join(qualityDir, 'index.m3u8');
        const segmentPattern = join(qualityDir, 'segment_%03d.ts');

        // Scale preserving aspect ratio within bounding box, making width/height even
        const scaleFilter = `scale='min(${preset.width},iw)':'min(${preset.height},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;

        const ffmpegCmd = `ffmpeg -y -i "${opts.inputPath}" -vf "${scaleFilter}" -c:v libx264 -preset fast -b:v ${preset.videoBitrate} -maxrate ${preset.maxRate} -bufsize ${preset.bufSize} -c:a aac -b:a ${preset.audioBitrate} -hls_time 6 -hls_playlist_type vod -hls_segment_filename "${segmentPattern}" "${playlistPath}"`;

        this.logger.log(`Transcoding ${quality} for ${mediaId}...`);
        await execAsync(ffmpegCmd);

        variantUrls[quality] = `${publicBaseUrl}/videos/hls/${mediaId}/${quality}/index.m3u8`;
      }

      // Generate master.m3u8 combining all generated quality variants
      let masterContent = '#EXTM3U\n#EXT-X-VERSION:3\n';
      for (const quality of validQualities) {
        const preset = QUALITY_PRESETS[quality];
        masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${preset.bandwidth},RESOLUTION=${preset.width}x${preset.height},NAME="${quality}"\n${quality}/index.m3u8\n`;
      }

      const masterPath = join(tempDir, 'master.m3u8');
      writeFileSync(masterPath, masterContent, 'utf-8');

      // Also create legacy playlist.m3u8 copy
      const legacyPath = join(tempDir, 'playlist.m3u8');
      writeFileSync(legacyPath, masterContent, 'utf-8');

      // Upload all files recursively to MinIO
      const uploadDirectory = async (dir: string, baseSub = '') => {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const relativeSub = baseSub ? `${baseSub}/${entry}` : entry;
          if (statSync(fullPath).isDirectory()) {
            await uploadDirectory(fullPath, relativeSub);
          } else {
            const buffer = readFileSync(fullPath);
            const objectName = `hls/${mediaId}/${relativeSub}`;
            const contentType = entry.endsWith('.m3u8')
              ? 'application/x-mpegURL'
              : 'video/mp2t';

            await this.minio.upload({
              bucket: 'videos',
              objectName,
              buffer,
              contentType,
            });
          }
        }
      };

      this.logger.log(`Uploading multi-quality HLS stream to MinIO for media ${mediaId}...`);
      await uploadDirectory(tempDir);

      rmSync(tempDir, { recursive: true, force: true });

      const masterUrl = `${publicBaseUrl}/videos/hls/${mediaId}/master.m3u8`;
      this.logger.log(`Multi-quality HLS stream ready at: ${masterUrl}`);

      return {
        masterUrl,
        variants: variantUrls,
        analysis,
      };
    } catch (err: any) {
      this.logger.error(`Video multi-quality variants transcoding failed: ${err.message}`, err.stack);
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      throw err;
    }
  }

  /**
   * Single-command fallback / legacy
   */
  async transcodeVideoAndUpload(opts: {
    inputPath: string;
    mediaId?: string;
  }): Promise<string> {
    const res = await this.generateVideoVariants(opts);
    return res.masterUrl;
  }
}
