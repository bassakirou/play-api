import { MediaService } from './media.service';

jest.mock('../storage/vercel-blob.service', () => ({
  VercelBlobService: class {},
}));

describe('Video originals', () => {
  it('retains the video in MinIO even when the external blob service is enabled', async () => {
    let saved: any;
    const prisma = {
      mediaAsset: {
        create: async ({ data }: any) => (saved = { id: 'source-1', ...data }),
      },
    };
    const minio = {
      isEnabled: () => true,
      upload: jest.fn(async () => 'http://localhost:9000/videos/original.mp4'),
      getBucketName: () => 'videos',
    };
    const blob = {
      isEnabled: () => true,
      upload: jest.fn(async () => 'https://external.test/video.mp4'),
    };
    const transcoder = { generateAndUploadPoster: async () => null };
    const service = new MediaService(
      prisma as any,
      minio as any,
      blob as any,
      transcoder as any,
    );
    const result = await service.uploadAndCreate(
      {
        originalname: 'clip.mp4',
        mimetype: 'video/mp4',
        buffer: Buffer.from('source'),
        size: 6,
      } as any,
      { type: 'video' },
      'creator-1',
    );

    expect(result.fileUrl).toBe('http://localhost:9000/videos/original.mp4');
    expect(saved.originalBucket).toBe('videos');
    expect(saved.originalObject).toMatch(/\.mp4$/);
    expect(saved.userId).toBe('creator-1');
    expect(blob.upload).not.toHaveBeenCalled();
  });

  it('fails the publication upload if MinIO cannot retain its original', async () => {
    const service = new MediaService(
      {} as any,
      { isEnabled: () => false } as any,
      {
        isEnabled: () => true,
        upload: async () => 'https://external.test/video.mp4',
      } as any,
      {} as any,
    );
    await expect(
      service.uploadAndCreate({
        originalname: 'clip.mp4',
        mimetype: 'video/mp4',
        buffer: Buffer.from('x'),
      } as any),
    ).rejects.toThrow();
  });
});
