import { MinioService } from './minio.service';

it('revokes public media access while keeping only image buckets public', async () => {
  const service = new MinioService({ buckets: { audio: 'audio', videos: 'videos', images: 'images' } });
  const setBucketPolicy = jest.fn(async (_name: string, _policy: string) => {});
  (service as any).client = { listBuckets: async () => ['audio', 'videos', 'play-audio', 'images'].map(name => ({ name })), setBucketPolicy };
  await service.onModuleInit();
  expect(setBucketPolicy).toHaveBeenCalledWith('audio', '');
  expect(setBucketPolicy).toHaveBeenCalledWith('videos', '');
  expect(setBucketPolicy).toHaveBeenCalledWith('play-audio', '');
  expect(JSON.parse(setBucketPolicy.mock.calls.find((call: any) => call[0] === 'images')?.[1] || '{}').Statement[0].Action).toEqual(['s3:GetObject']);
});
