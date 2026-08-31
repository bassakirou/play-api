import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateArtistGroupDto } from './dto/create-artist-group.dto';

@Injectable()
export class ArtistGroupsService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  async create(dto: CreateArtistGroupDto, user?: any) {
    const creatorUserId = user?.userId || user?.id || null;

    // 1. Trouver le profil artiste de l'utilisateur connecté s'il existe
    let creatorArtist: any = null;
    if (creatorUserId) {
      creatorArtist = await this.prisma.artist.findUnique({
        where: { userId: creatorUserId },
      });
    }

    const requestedMemberIds = dto.memberIds || [];
    const directConnectArtistIds = new Set<string>();
    const inviteArtistIds = new Set<string>();

    // Si le créateur est un artiste, il est automatiquement membre direct
    if (creatorArtist) {
      directConnectArtistIds.add(creatorArtist.id);
    }

    // Récupérer les informations des artistes sélectionnés
    if (requestedMemberIds.length > 0) {
      const selectedArtists = await this.prisma.artist.findMany({
        where: { id: { in: requestedMemberIds } },
        include: { user: true },
      });

      for (const artist of selectedArtists) {
        if (creatorArtist && artist.id === creatorArtist.id) {
          directConnectArtistIds.add(artist.id);
        } else if (!artist.userId || !artist.user) {
          // Artiste catalogue sans compte utilisateur -> membre direct
          directConnectArtistIds.add(artist.id);
        } else {
          // Artiste avec compte utilisateur enregistré -> invitation requise
          inviteArtistIds.add(artist.id);
        }
      }
    }

    // Traitement des customMembers
    let customMembersStr: string | null = null;
    if (dto.customMembers) {
      if (Array.isArray(dto.customMembers)) {
        customMembersStr = JSON.stringify(dto.customMembers);
      } else if (typeof dto.customMembers === 'string') {
        try {
          // Si déjà JSON ou simple chaîne
          JSON.parse(dto.customMembers);
          customMembersStr = dto.customMembers;
        } catch {
          customMembersStr = JSON.stringify(
            dto.customMembers.split(',').map((s) => s.trim()).filter(Boolean),
          );
        }
      }
    }

    // Création du groupe
    const group = await this.prisma.artistGroup.create({
      data: {
        name: dto.name.trim(),
        imageUrl: dto.imageUrl || null,
        creatorId: creatorUserId,
        customMembers: customMembersStr,
        members: {
          connect: Array.from(directConnectArtistIds).map((id) => ({ id })),
        },
      },
      include: {
        members: true,
      },
    });

    // Création des invitations pour les artistes enregistrés
    const inviterName = creatorArtist?.name || user?.name || 'Un artiste';
    for (const artistId of Array.from(inviteArtistIds)) {
      try {
        const inv = await this.prisma.artistGroupInvitation.create({
          data: {
            groupId: group.id,
            artistId,
            status: 'PENDING',
          },
          include: {
            artist: { include: { user: true } },
          },
        });

        // Envoi d'e-mail si l'artiste a une adresse e-mail
        const targetEmail = inv.artist?.user?.email;
        if (targetEmail) {
          this.mailService.sendGroupInvitationEmail({
            to: targetEmail,
            artistName: inv.artist.name,
            groupName: group.name,
            inviterName,
            studioUrl: dto.studioUrl,
          });
        }
      } catch (err) {
        console.warn(`[ArtistGroups] Impossible de créer l'invitation pour l'artiste ${artistId}:`, err);
      }
    }

    return this.findOne(group.id);
  }

  async findAll(creatorId?: string) {
    const groups = await this.prisma.artistGroup.findMany({
      where: creatorId
        ? {
            OR: [
              { creatorId },
              { members: { some: { OR: [{ userId: creatorId }, { id: creatorId }] } } },
              { invitations: { some: { artist: { OR: [{ userId: creatorId }, { id: creatorId }] } } } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        members: {
          include: {
            user: { select: { id: true, email: true, name: true } },
          },
        },
        invitations: {
          include: {
            artist: {
              include: { user: { select: { id: true, email: true, name: true } } },
            },
          },
        },
        songs: {
          select: {
            id: true,
            title: true,
            duration: true,
            coverUrl: true,
          },
        },
        albums: {
          select: {
            id: true,
            title: true,
            year: true,
            coverUrl: true,
          },
        },
        _count: {
          select: {
            members: true,
            songs: true,
            albums: true,
            invitations: true,
          },
        },
      },
    });

    return groups;
  }

  async findOne(id: string) {
    const group = await this.prisma.artistGroup.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: { select: { id: true, email: true, name: true } },
          },
        },
        invitations: {
          include: {
            artist: {
              include: { user: { select: { id: true, email: true, name: true } } },
            },
          },
        },
        songs: {
          include: {
            genres: true,
            album: true,
          },
        },
        albums: {
          include: {
            songs: true,
          },
        },
        _count: {
          select: {
            members: true,
            songs: true,
            albums: true,
            invitations: true,
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Groupe d’artistes introuvable');
    }

    return group;
  }

  async update(id: string, dto: CreateArtistGroupDto, user?: any) {
    const existing = await this.prisma.artistGroup.findUnique({
      where: { id },
      include: { members: true, invitations: true },
    });

    if (!existing) {
      throw new NotFoundException('Groupe d’artistes introuvable');
    }

    const data: any = {
      name: dto.name.trim(),
      ...(typeof dto.imageUrl !== 'undefined' ? { imageUrl: dto.imageUrl || null } : {}),
    };

    if (dto.customMembers !== undefined) {
      if (Array.isArray(dto.customMembers)) {
        data.customMembers = JSON.stringify(dto.customMembers);
      } else if (typeof dto.customMembers === 'string') {
        data.customMembers = dto.customMembers;
      } else {
        data.customMembers = null;
      }
    }

    // Gestion des membres s'ils sont transmis
    if (dto.memberIds) {
      const currentMemberIds = existing.members.map((m) => m.id);
      const requestedIds = dto.memberIds;

      const toAdd = requestedIds.filter((mid) => !currentMemberIds.includes(mid));
      const toRemove = currentMemberIds.filter((mid) => !requestedIds.includes(mid));

      if (toRemove.length > 0) {
        data.members = {
          disconnect: toRemove.map((mid) => ({ id: mid })),
        };
      }

      if (toAdd.length > 0) {
        const artistsToAdd = await this.prisma.artist.findMany({
          where: { id: { in: toAdd } },
          include: { user: true },
        });

        const directConnectIds: string[] = [];
        const inviterName = user?.name || 'Un administrateur';

        for (const a of artistsToAdd) {
          if (!a.userId || !a.user) {
            directConnectIds.push(a.id);
          } else {
            // Créer une invitation
            try {
              const inv = await this.prisma.artistGroupInvitation.upsert({
                where: { groupId_artistId: { groupId: id, artistId: a.id } },
                create: { groupId: id, artistId: a.id, status: 'PENDING' },
                update: { status: 'PENDING' },
                include: { artist: { include: { user: true } } },
              });

              if (inv.artist?.user?.email) {
                this.mailService.sendGroupInvitationEmail({
                  to: inv.artist.user.email,
                  artistName: inv.artist.name,
                  groupName: dto.name || existing.name,
                  inviterName,
                  studioUrl: dto.studioUrl,
                });
              }
            } catch {}
          }
        }

        if (directConnectIds.length > 0) {
          data.members = {
            ...(data.members || {}),
            connect: directConnectIds.map((mid) => ({ id: mid })),
          };
        }
      }
    }

    await this.prisma.artistGroup.update({
      where: { id },
      data,
    });

    return this.findOne(id);
  }

  async remove(id: string) {
    return this.prisma.artistGroup.delete({ where: { id } });
  }

  async findInvitationsForUser(user: any) {
    const userId = user?.userId || user?.id;
    if (!userId) return [];

    const artist = await this.prisma.artist.findUnique({
      where: { userId },
    });

    if (!artist) return [];

    return this.prisma.artistGroupInvitation.findMany({
      where: {
        artistId: artist.id,
        status: 'PENDING',
      },
      include: {
        group: {
          include: {
            members: true,
            _count: { select: { members: true, songs: true } },
          },
        },
        artist: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async respondInvitation(
    invitationId: string,
    status: 'ACCEPTED' | 'REJECTED',
    user: any,
    studioUrl?: string,
  ) {
    const userId = user?.userId || user?.id;
    const invitation = await this.prisma.artistGroupInvitation.findUnique({
      where: { id: invitationId },
      include: {
        artist: { include: { user: true } },
        group: true,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation introuvable');
    }

    if (invitation.artist?.userId !== userId && user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      throw new ForbiddenException('Cette invitation ne vous est pas destinée');
    }

    if (status === 'ACCEPTED') {
      await this.prisma.$transaction([
        this.prisma.artistGroupInvitation.update({
          where: { id: invitationId },
          data: { status: 'ACCEPTED' },
        }),
        this.prisma.artistGroup.update({
          where: { id: invitation.groupId },
          data: {
            members: {
              connect: { id: invitation.artistId },
            },
          },
        }),
      ]);

      // Envoyer email au créateur du groupe
      if (invitation.group?.creatorId) {
        const creatorUser = await this.prisma.user.findUnique({
          where: { id: invitation.group.creatorId },
        });

        if (creatorUser?.email) {
          this.mailService.sendGroupInvitationAcceptedEmail({
            to: creatorUser.email,
            groupName: invitation.group.name,
            memberName: invitation.artist.name,
            studioUrl,
          });
        }
      }

      return { message: 'Invitation acceptée avec succès', status: 'ACCEPTED' };
    } else {
      await this.prisma.artistGroupInvitation.update({
        where: { id: invitationId },
        data: { status: 'REJECTED' },
      });

      return { message: 'Invitation refusée', status: 'REJECTED' };
    }
  }
}
