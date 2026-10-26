import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

export interface StreamVideo {
  uid: string;
  readyToStream?: boolean;
  status?: { state: string; pctComplete?: string; errorReasonCode?: string };
  meta?: { mediaAssetId?: string };
}

@Injectable()
export class CloudflareStreamService {
  constructor(private readonly config: ConfigService) {}

  configuration() {
    const requested =
      this.config.get('VIDEO_DELIVERY_PROVIDER') === 'cloudflare';
    const required = [
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_STREAM_API_TOKEN',
      'CLOUDFLARE_STREAM_CUSTOMER_CODE',
      'CLOUDFLARE_STREAM_WEBHOOK_SECRET',
      'VIDEO_DELIVERY_ORIGIN_URL',
    ];
    const missing = requested
      ? required.filter((key) => !this.config.get<string>(key)?.trim())
      : [];
    return {
      provider: requested ? 'CLOUDFLARE' : 'MINIO',
      requested,
      configured: requested && !missing.length,
      missing,
    };
  }

  isEnabled() {
    return this.configuration().configured;
  }

  sourceUrl(mediaAssetId: string) {
    if (!this.isEnabled())
      throw new ServiceUnavailableException('Cloudflare Stream non configuré');
    const base = new URL(this.config.get<string>('VIDEO_DELIVERY_ORIGIN_URL')!);
    if (
      base.protocol !== 'https:' ||
      /^(localhost|127\.|\[?::1\]?)/i.test(base.hostname)
    ) {
      throw new ServiceUnavailableException(
        'Adresse d’origine publique HTTPS requise',
      );
    }
    const expires = String(Math.floor(Date.now() / 1000) + 6 * 3600);
    const signature = this.sourceSignature(mediaAssetId, expires);
    return `${base.origin}/video-delivery/source/${encodeURIComponent(mediaAssetId)}?expires=${expires}&signature=${signature}`;
  }

  private sourceSignature(mediaAssetId: string, expires: string) {
    return createHmac(
      'sha256',
      this.config.get<string>('CLOUDFLARE_STREAM_WEBHOOK_SECRET') || '',
    )
      .update(`pyramidplay:source:${mediaAssetId}:${expires}`)
      .digest('hex');
  }

  verifySource(mediaAssetId: string, expires?: string, signature?: string) {
    if (
      !this.isEnabled() ||
      !expires ||
      !signature ||
      !/^\d+$/.test(expires) ||
      !/^[a-f0-9]{64}$/i.test(signature)
    )
      return false;
    const now = Math.floor(Date.now() / 1000);
    if (Number(expires) <= now || Number(expires) > now + 6 * 3600 + 60)
      return false;
    return timingSafeEqual(
      Buffer.from(this.sourceSignature(mediaAssetId, expires), 'hex'),
      Buffer.from(signature, 'hex'),
    );
  }

  private async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<T> {
    if (!this.isEnabled())
      throw new ServiceUnavailableException('Cloudflare Stream non configuré');
    let response: Response;
    try {
      response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.get<string>('CLOUDFLARE_ACCOUNT_ID')!)}/stream${path}`,
        {
          method,
          signal: AbortSignal.timeout(20_000),
          headers: {
            Authorization: `Bearer ${this.config.get('CLOUDFLARE_STREAM_API_TOKEN')}`,
            'Content-Type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Cloudflare Stream temporairement inaccessible',
      );
    }
    if (!response.ok)
      throw new ServiceUnavailableException(
        `Cloudflare Stream : requête refusée (${response.status})`,
      );
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      result?: T;
    } | null;
    if (!payload?.success || !payload.result)
      throw new ServiceUnavailableException(
        'Réponse Cloudflare Stream invalide',
      );
    return payload.result;
  }

  copy(sourceUrl: string, mediaAssetId: string) {
    return this.request<StreamVideo>('/copy', 'POST', {
      url: sourceUrl,
      requireSignedURLs: true,
      meta: { mediaAssetId, name: mediaAssetId },
      allowedOrigins: (
        this.config.get<string>('CLOUDFLARE_STREAM_ALLOWED_ORIGINS') || ''
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }

  inspect(uid: string) {
    return this.request<StreamVideo>(`/${encodeURIComponent(uid)}`);
  }

  async findCopy(mediaAssetId: string) {
    const videos = await this.request<StreamVideo[]>(
      `?search=${encodeURIComponent(mediaAssetId)}`,
    );
    return (
      videos.find(
        (video) =>
          video.meta?.mediaAssetId === mediaAssetId &&
          video.status?.state !== 'error',
      ) || null
    );
  }

  async playback(uid: string) {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const result = await this.request<{ token: string }>(
      `/${encodeURIComponent(uid)}/token`,
      'POST',
      { exp: expiresAt },
    );
    if (
      typeof result.token !== 'string' ||
      !/^[A-Za-z0-9_.-]+$/.test(result.token)
    ) {
      throw new ServiceUnavailableException(
        'Jeton de lecture Cloudflare invalide',
      );
    }
    const customer = this.config.get<string>(
      'CLOUDFLARE_STREAM_CUSTOMER_CODE',
    )!;
    if (!/^customer-[a-zA-Z0-9-]+$/.test(customer))
      throw new ServiceUnavailableException('Code client Cloudflare invalide');
    return {
      url: `https://${customer}.cloudflarestream.com/${result.token}/manifest/video.m3u8`,
      expiresAt,
    };
  }

  verifyWebhook(body: Buffer, header?: string) {
    const secret = this.config.get<string>('CLOUDFLARE_STREAM_WEBHOOK_SECRET');
    if (!secret || !header || !Buffer.isBuffer(body)) return false;
    const fields = Object.fromEntries(
      header.split(',').map((part) => part.trim().split('=')),
    );
    const timestamp = Number(fields.time);
    if (
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() / 1000 - timestamp) > 300 ||
      !/^[a-f0-9]{64}$/i.test(fields.sig1 || '')
    )
      return false;
    const expected = createHmac('sha256', secret)
      .update(`${fields.time}.`)
      .update(body)
      .digest();
    return timingSafeEqual(expected, Buffer.from(fields.sig1, 'hex'));
  }
}
