import { isMediaStorageUrl } from '../content-access/media-storage-url';

export const giftImageReference = /^(?:https?:\/\/[^/\s]+\/[^\s]+|\/(?!\/)[^\s]+)$/i;

export function publicGiftIconUrl(iconUrl: string): string {
  const source = iconUrl.trim();
  if (!giftImageReference.test(source)) return source;

  try {
    const url = new URL(source, 'http://local.invalid');
    const bucket = url.pathname.split('/')[1];
    const imageBuckets = [process.env.MINIO_BUCKET_IMAGES || 'images', 'images', 'play-images'];
    const isBlob = url.hostname.endsWith('.public.blob.vercel-storage.com');
    const isMinioImage = isMediaStorageUrl(source) && imageBuckets.includes(bucket);
    if (isBlob || isMinioImage) return `/files/resolved-image?url=${encodeURIComponent(source)}`;
  } catch {
    return source;
  }
  return source;
}
