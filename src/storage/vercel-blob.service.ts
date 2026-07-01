import { Injectable } from '@nestjs/common';
import { put } from '@vercel/blob';


@Injectable()
export class VercelBlobService {
  isEnabled() {
    return !!process.env.BLOB_READ_WRITE_TOKEN;
  }

  async generateToken(pathname: string) {
    if (!this.isEnabled()) {
      throw new Error('Vercel Blob token is missing');
    }
    const mod: any = await import('@vercel/blob');
    const fn =
      mod.generateClientToken || mod.generateUploadToken || mod.generateToken;
    if (typeof fn !== 'function') {
      throw new Error('Vercel Blob token generator is not available');
    }
    return fn({
      pathname,
      onUploadCompleted: async (payload: any) => {
        console.log('[VercelBlobService] Client upload completed:', payload);
      },
    });
  }

  async upload(opts: {
    bucket?: string; // Non utilisé par Vercel Blob mais gardé pour compatibilité
    objectName: string;
    buffer: Buffer;
    contentType?: string;
  }) {
    if (!this.isEnabled()) {
      throw new Error('Vercel Blob token is missing (BLOB_READ_WRITE_TOKEN)');
    }

    const { url } = await put(opts.objectName, opts.buffer, {
      access: 'public',
      contentType: opts.contentType,
    });

    console.log(`[VercelBlobService] Upload successful: ${url}`);
    return url;
  }

  // Pour Vercel Blob, l'URL est retournée directement lors de l'upload.
  // Cette méthode est gardée pour la structure si besoin de générer des URLs après coup.
  async presignGet(opts: { objectName: string }) {
    // Vercel Blob URLs sont permanentes par défaut si publiques.
    // On pourrait implémenter une logique de récupération ici si on stockait les URLs.
    return opts.objectName;
  }
}
