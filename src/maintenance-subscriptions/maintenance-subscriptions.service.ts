import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateMaintenanceSubscriptionDto } from './dto/create-maintenance-subscription.dto';
import { UpdateMaintenanceStateDto } from './dto/update-maintenance-state.dto';

@Injectable()
export class MaintenanceSubscriptionsService {
  private readonly logger = new Logger(MaintenanceSubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private buildStats(items: Array<{ notifiedAt: Date | null }>) {
    return {
      total: items.length,
      pending: items.filter((item) => !item.notifiedAt).length,
      notified: items.filter((item) => item.notifiedAt).length,
    };
  }

  private parseMaintenanceOverride() {
    const value =
      this.configService
        .get<string>('MAINTENANCE_MODE_OVERRIDE')
        ?.trim()
        .toLowerCase() || '';

    if (!value) return null;
    if (['on', 'true', '1'].includes(value)) return true;
    if (['off', 'false', '0'].includes(value)) return false;

    this.logger.warn(
      `Ignoring invalid MAINTENANCE_MODE_OVERRIDE value: ${value}`,
    );
    return null;
  }

  private buildStateResponse(state: {
    id: string;
    enabled: boolean;
    updatedAt: Date;
  }) {
    const overrideEnabled = this.parseMaintenanceOverride();

    return {
      ...state,
      enabled: overrideEnabled ?? state.enabled,
      adminEnabled: state.enabled,
      overrideEnabled,
      source: overrideEnabled === null ? 'admin' : 'env',
    };
  }

  async getState() {
    const state = await this.prisma.maintenanceState.upsert({
      where: { id: 'default' },
      update: {},
      create: {
        id: 'default',
        enabled: false,
      },
    });

    return this.buildStateResponse(state);
  }

  async updateState(updateDto: UpdateMaintenanceStateDto) {
    const overrideEnabled = this.parseMaintenanceOverride();

    if (overrideEnabled !== null) {
      throw new ConflictException(
        `Le mode maintenance est force via MAINTENANCE_MODE_OVERRIDE=${overrideEnabled ? 'on' : 'off'}. Videz cette variable pour reutiliser l admin.`,
      );
    }

    const state = await this.prisma.maintenanceState.upsert({
      where: { id: 'default' },
      update: { enabled: updateDto.enabled },
      create: {
        id: 'default',
        enabled: updateDto.enabled,
      },
    });

    return this.buildStateResponse(state);
  }

  async create(createDto: CreateMaintenanceSubscriptionDto) {
    const email = this.normalizeEmail(createDto.email);

    const existing = await this.prisma.maintenanceSubscription.findUnique({
      where: { email },
    });

    if (existing) {
      return {
        success: true,
        alreadySubscribed: true,
        subscription: existing,
      };
    }

    const subscription = await this.prisma.maintenanceSubscription.create({
      data: { email },
    });

    const subscriptions = await this.prisma.maintenanceSubscription.findMany({
      select: { notifiedAt: true },
    });
    const stats = this.buildStats(subscriptions);

    try {
      await this.mailService.sendMaintenanceSubscriptionAdminAlert({
        subscriberEmail: subscription.email,
        subscribedAt: subscription.createdAt,
        ...stats,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send maintenance admin alert for ${subscription.email}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return {
      success: true,
      alreadySubscribed: false,
      subscription,
      stats,
    };
  }

  async findAll() {
    const subscriptions = await this.prisma.maintenanceSubscription.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: subscriptions,
      stats: this.buildStats(subscriptions),
    };
  }

  async notifyAll() {
    const pending = await this.prisma.maintenanceSubscription.findMany({
      where: { notifiedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    if (pending.length === 0) {
      return {
        success: true,
        sent: 0,
        failed: 0,
        message: 'Aucune nouvelle inscription a notifier.',
      };
    }

    const platformUrl =
      this.configService.get<string>('APP_WEB_URL') || 'http://localhost:5173';

    let sent = 0;
    const failures: string[] = [];

    for (const subscription of pending) {
      try {
        await this.mailService.sendPlatformAvailableEmail(
          subscription.email,
          platformUrl,
        );

        await this.prisma.maintenanceSubscription.update({
          where: { id: subscription.id },
          data: { notifiedAt: new Date() },
        });

        sent += 1;
      } catch {
        failures.push(subscription.email);
      }
    }

    const subscriptions = await this.prisma.maintenanceSubscription.findMany({
      select: { notifiedAt: true },
    });
    const stats = this.buildStats(subscriptions);

    try {
      await this.mailService.sendMaintenanceNotificationBatchAdminAlert({
        sent,
        failed: failures.length,
        failures,
        ...stats,
      });
    } catch (error) {
      this.logger.error(
        'Failed to send maintenance batch admin alert',
        error instanceof Error ? error.stack : undefined,
      );
    }

    return {
      success: failures.length === 0,
      sent,
      failed: failures.length,
      failures,
      stats,
      message:
        failures.length === 0
          ? 'Les alertes ont ete envoyees avec succes.'
          : 'Certaines alertes n ont pas pu etre envoyees.',
    };
  }
}
