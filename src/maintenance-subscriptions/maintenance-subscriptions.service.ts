import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateMaintenanceSubscriptionDto } from './dto/create-maintenance-subscription.dto';
import { UpdateMaintenanceStateDto } from './dto/update-maintenance-state.dto';

@Injectable()
export class MaintenanceSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  async getState() {
    return this.prisma.maintenanceState.upsert({
      where: { id: 'default' },
      update: {},
      create: {
        id: 'default',
        enabled: false,
      },
    });
  }

  async updateState(updateDto: UpdateMaintenanceStateDto) {
    return this.prisma.maintenanceState.upsert({
      where: { id: 'default' },
      update: { enabled: updateDto.enabled },
      create: {
        id: 'default',
        enabled: updateDto.enabled,
      },
    });
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

    return {
      success: true,
      alreadySubscribed: false,
      subscription,
    };
  }

  async findAll() {
    const subscriptions = await this.prisma.maintenanceSubscription.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: subscriptions,
      stats: {
        total: subscriptions.length,
        pending: subscriptions.filter((item) => !item.notifiedAt).length,
        notified: subscriptions.filter((item) => item.notifiedAt).length,
      },
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

    return {
      success: failures.length === 0,
      sent,
      failed: failures.length,
      failures,
      message:
        failures.length === 0
          ? 'Les alertes ont ete envoyees avec succes.'
          : 'Certaines alertes n ont pas pu etre envoyees.',
    };
  }
}
