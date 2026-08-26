import { Injectable, OnModuleInit, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';

export const SYSTEM_ROLES = ['ADMIN', 'SUPER_ADMIN', 'USER', 'ARTIST', 'AUTHOR', 'CREATOR'];

@Injectable()
export class RolesService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    // 1. Initialisation des rôles système réservés
    const roles = ['SUPER_ADMIN', 'ADMIN', 'USER', 'ARTIST', 'AUTHOR', 'CREATOR'];
    for (const roleName of roles) {
      const exists = await this.prisma.role.findUnique({
        where: { name: roleName },
      });
      if (!exists) {
        await this.prisma.role.create({ data: { name: roleName } });
      }
    }

    // 2. Promotion automatique de bassahakjm@gmail.com en SUPER_ADMIN
    try {
      const superAdminRole = await this.prisma.role.findUnique({
        where: { name: 'SUPER_ADMIN' },
      });
      if (superAdminRole) {
        const targetUser = await this.prisma.user.findUnique({
          where: { email: 'bassahakjm@gmail.com' },
        });
        if (targetUser) {
          const currentSys = Array.isArray(targetUser.systemRoles) ? [...targetUser.systemRoles] : [];
          if (!currentSys.includes('SUPER_ADMIN')) currentSys.push('SUPER_ADMIN');
          if (!currentSys.includes('ADMIN')) currentSys.push('ADMIN');

          await this.prisma.user.update({
            where: { email: 'bassahakjm@gmail.com' },
            data: {
              roleId: superAdminRole.id,
              systemRoles: currentSys,
            },
          });
        }
      }
    } catch {
      // ignore
    }
  }

  async create(createRoleDto: CreateRoleDto) {
    const roleName = createRoleDto.name.trim().toUpperCase();
    if (SYSTEM_ROLES.includes(roleName)) {
      throw new BadRequestException(`"${roleName}" est un rôle système réservé et ne peut pas être créé.`);
    }

    const { permissions, ...data } = createRoleDto;
    return this.prisma.role.create({
      data: {
        ...data,
        name: roleName,
        permissions: permissions
          ? { connect: permissions.map((id) => ({ id })) }
          : undefined,
      },
    });
  }

  findAll() {
    return this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: true },
    });
  }

  findOne(id: string) {
    return this.prisma.role.findUnique({
      where: { id },
      include: { permissions: true },
    });
  }

  findByName(name: string) {
    return this.prisma.role.findUnique({ where: { name } });
  }

  async update(id: string, updateRoleDto: any) {
    const existing = await this.prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Rôle non trouvé');

    if (SYSTEM_ROLES.includes(existing.name)) {
      throw new BadRequestException(`Le rôle système "${existing.name}" n'est pas modifiable.`);
    }

    const roleName = updateRoleDto.name ? updateRoleDto.name.trim().toUpperCase() : existing.name;
    const { permissions, ...data } = updateRoleDto;
    return this.prisma.role.update({
      where: { id },
      data: {
        ...data,
        name: roleName,
        permissions: permissions
          ? { set: permissions.map((pid: string) => ({ id: pid })) }
          : undefined,
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Rôle non trouvé');

    if (SYSTEM_ROLES.includes(existing.name.toUpperCase())) {
      throw new BadRequestException(`Le rôle système "${existing.name}" est protégé et ne peut pas être supprimé.`);
    }

    return this.prisma.role.delete({ where: { id } });
  }
}
