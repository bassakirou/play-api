/** Only these origins may be interpreted as storage paths by the API. */
export function isMediaStorageUrl(source: string) {
  try {
    const url = new URL(source, 'http://local.invalid');
    const hosts = new Set(['local.invalid', 'localhost', '127.0.0.1', 'media.pyramidplay.cm']);
    for (const value of [process.env.MINIO_PUBLIC_URL, process.env.MINIO_ENDPOINT]) {
      if (value) hosts.add(new URL(value.includes('://') ? value : `http://${value}`).hostname);
    }
    return ['http:', 'https:'].includes(url.protocol) && (hosts.has(url.hostname) || url.hostname.endsWith('.private.blob.vercel-storage.com'));
  } catch { return false; }
}
