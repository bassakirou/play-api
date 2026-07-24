import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateArtistGroupDto } from './dto/create-artist-group.dto';

@Injectable()
export class ArtistGroupsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateArtistGroupDto) {
    const data: any = {
      name: dto.name,
      imageUrl: dto.imageUrl || null,
      ...(dto.memberIds && dto.memberIds.length
        ? { members: { connect: dto.memberIds.map((id) => ({ id })) } }
        : {}),
    };
    return this.prisma.artistGroup.create({
      data,
    });
  }

  findAll() {
    return this.prisma.artistGroup.findMany({
      orderBy: { createdAt: 'desc' },
      include: { members: true },
    });
  }

  findOne(id: string) {
    return this.prisma.artistGroup.findUnique({
      where: { id },
      include: { members: true },
    });
  }

  update(id: string, dto: CreateArtistGroupDto) {
    const data: any = {
      name: dto.name,
      ...(typeof dto.imageUrl !== 'undefined' ? { imageUrl: dto.imageUrl || null } : {}),
      ...(dto.memberIds
        ? { members: { set: dto.memberIds.map((mid) => ({ id: mid })) } }
        : {}),
    };
    return this.prisma.artistGroup.update({
      where: { id },
      data,
    });
  }

  remove(id: string) {
    return this.prisma.artistGroup.delete({ where: { id } });
  }
}
