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
    const admins = await this.prisma.role.findMany({
      where: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    });
    const allPerms = await this.prisma.permission.findMany();
    for (const admin of admins) {
      await this.prisma.role.update({
        where: { id: admin.id },
        data: {
          permissions: { set: allPerms.map((p) => ({ id: p.id })) },
        },
      });
    }

    const editor = await this.prisma.role.findFirst({
      where: { name: { equals: 'EDITOR', mode: 'insensitive' } },
      include: { permissions: true },
    });
    if (editor) {
      const editorPerms = await this.prisma.permission.findMany({
        where: { resource: { in: ['song', 'video', 'album', 'artist', 'genre'] } },
      });
      const currentIds = new Set(editor.permissions.map((p) => p.id));
      const missing = editorPerms.filter((p) => !currentIds.has(p.id));
      if (missing.length > 0) {
        await this.prisma.role.update({
          where: { id: editor.id },
          data: {
            permissions: { connect: missing.map((p) => ({ id: p.id })) },
          },
        });
      }
    }
  }

  findAll() {
    return this.prisma.permission.findMany();
  }
}
