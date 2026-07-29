import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionsService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    const actions = ['create', 'read', 'update', 'delete', 'manage'];
    const resources = ['song', 'video', 'album', 'artist', 'genre', 'user', 'role'];
    for (const action of actions) {
      for (const resource of resources) {
        const exists = await this.prisma.permission.findFirst({
          where: { action, resource },
        });
        if (!exists) {
          await this.prisma.permission.create({ data: { action, resource } });
        }
      }
    }
    const admin = await this.prisma.role.findUnique({
      where: { name: 'ADMIN' },
    });
    if (admin) {
      const allPerms = await this.prisma.permission.findMany();
      await this.prisma.role.update({
        where: { id: admin.id },
        data: {
          permissions: { set: allPerms.map((p) => ({ id: p.id })) },
        },
      });
    }
  }

  findAll() {
    return this.prisma.permission.findMany();
  }
}
