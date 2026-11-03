import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AcademicSubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  async isAdmin(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { systemRoles: true, role: { select: { name: true } } },
    });
    return (
      !!user &&
      (user.systemRoles.some((role) =>
        ['ADMIN', 'SUPER_ADMIN'].includes(role),
      ) ||
        ['ADMIN', 'SUPER_ADMIN'].includes(user.role?.name || ''))
    );
  }

  async assertCanPublish(userId: string): Promise<void> {
    if (await this.isAdmin(userId)) return;
    const now = new Date();
    const subscription = await this.prisma.userSubscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        startDate: { lte: now },
        endDate: { gt: now },
        plan: { code: 'ACADEMIC_MONTHLY' },
      },
    });
    if (!subscription)
      throw new ForbiddenException(
        'Un abonnement formateur actif est nécessaire pour publier.',
      );
  }
}
