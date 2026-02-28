import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';

@Injectable()
export class RolesService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    // Seed default roles
    const roles = ['ADMIN', 'CREATOR', 'LABEL', 'USER'];
    for (const roleName of roles) {
      const exists = await this.prisma.role.findUnique({
        where: { name: roleName },
      });
      if (!exists) {
        await this.prisma.role.create({ data: { name: roleName } });
      }
    }
  }

  create(createRoleDto: CreateRoleDto) {
    const { permissions, ...data } = createRoleDto;
    return this.prisma.role.create({
      data: {
        ...data,
        permissions: permissions
          ? { connect: permissions.map((id) => ({ id })) }
          : undefined,
      },
    });
  }

  findAll() {
    return this.prisma.role.findMany({ include: { permissions: true } });
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

  update(id: string, updateRoleDto: any) {
    const { permissions, ...data } = updateRoleDto;
    return this.prisma.role.update({
      where: { id },
      data: {
        ...data,
        permissions: permissions
          ? { set: permissions.map((id: string) => ({ id })) }
          : undefined,
      },
    });
  }

  remove(id: string) {
    return this.prisma.role.delete({ where: { id } });
  }
}
