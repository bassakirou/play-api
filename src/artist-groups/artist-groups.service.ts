import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateArtistGroupDto } from './dto/create-artist-group.dto';

@Injectable()
export class ArtistGroupsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateArtistGroupDto) {
    return this.prisma.artistGroup.create({
      data: {
        name: dto.name,
        ...(dto.memberIds && dto.memberIds.length
          ? { members: { connect: dto.memberIds.map((id) => ({ id })) } }
          : {}),
      },
    });
  }

  findAll() {
    return this.prisma.artistGroup.findMany({ include: { members: true } });
  }

  findOne(id: string) {
    return this.prisma.artistGroup.findUnique({
      where: { id },
      include: { members: true },
    });
  }

  update(id: string, dto: CreateArtistGroupDto) {
    return this.prisma.artistGroup.update({
      where: { id },
      data: {
        name: dto.name,
        ...(dto.memberIds
          ? { members: { set: dto.memberIds.map((mid) => ({ id: mid })) } }
          : {}),
      },
    });
  }

  remove(id: string) {
    return this.prisma.artistGroup.delete({ where: { id } });
  }
}
