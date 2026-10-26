import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExternalProbeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async receive(body: Buffer | undefined, signature: string | undefined) {
    const secret = this.config.get<string>('MONITOR_EXTERNAL_PROBE_SECRET');
    if (
      !secret ||
      secret.length < 32 ||
      !body ||
      body.length > 4096 ||
      !signature ||
      !/^[a-f0-9]{64}$/.test(signature)
    )
      throw new UnauthorizedException();
    const expected = createHmac('sha256', secret).update(body).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      throw new UnauthorizedException();
    let data: any;
    try {
      data = JSON.parse(body.toString('utf8'));
    } catch {
      throw new BadRequestException();
    }
    if (
      !data ||
      typeof data !== 'object' ||
      typeof data.probeId !== 'string' ||
      typeof data.observedAt !== 'string'
    )
      throw new BadRequestException();
    const time = Date.parse(data.observedAt);
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(data.probeId) ||
      !['up', 'down'].includes(data.status) ||
      !Number.isFinite(time) ||
      time < Date.now() - 48 * 3_600_000 ||
      time > Date.now() + 300_000 ||
      (data.latencyMs != null &&
        (typeof data.latencyMs !== 'number' ||
          !Number.isFinite(data.latencyMs) ||
          data.latencyMs < 0 ||
          data.latencyMs > 60_000))
    )
      throw new BadRequestException('Relevé de sonde invalide');
    const observedAt = new Date(time);
    await this.prisma.videoExternalProbe.upsert({
      where: { probeId_observedAt: { probeId: data.probeId, observedAt } },
      create: {
        probeId: data.probeId,
        observedAt,
        status: data.status,
        latencyMs: data.latencyMs ?? null,
      },
      update: {},
    });
    return { accepted: true };
  }
}
