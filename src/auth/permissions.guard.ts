import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.get<string[]>(
      'permissions',
      context.getHandler(),
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      return false;
    }

    const roleName = (user.role || '').toUpperCase();

    // 1. Super Admin ou Admin a accès absolu
    if (roleName === 'ADMIN' || roleName === 'SUPER_ADMIN') {
      return true;
    }

    // Récupération de l'utilisateur avec ses rôles système, profil artiste et ses permissions DB
    const userWithPerms = await this.prisma.user.findUnique({
      where: { id: user.userId },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
        artistProfile: true,
      },
    });

    if (!userWithPerms) {
      return false;
    }

    const userDbRole = (userWithPerms.role?.name || '').toUpperCase();
    if (userDbRole === 'ADMIN' || userDbRole === 'SUPER_ADMIN') {
      return true;
    }

    const systemRoles = Array.isArray(userWithPerms.systemRoles)
      ? userWithPerms.systemRoles.map((r) => r.toUpperCase())
      : [];

    if (userWithPerms.artistProfile && !systemRoles.includes('ARTIST')) {
      systemRoles.push('ARTIST');
    }
    if (userDbRole && !systemRoles.includes(userDbRole)) {
      systemRoles.push(userDbRole);
    }

    if (systemRoles.includes('ADMIN') || systemRoles.includes('SUPER_ADMIN')) {
      return true;
    }

    // 2. Construction dynamique des permissions à partir des systemRoles
    const grantedPermissions = new Set<string>();

    // Rôle ARTIST : singles, albums, artistes, genres
    if (systemRoles.includes('ARTIST') || userDbRole === 'ARTIST' || !!userWithPerms.artistProfile) {
      grantedPermissions.add('create:song');
      grantedPermissions.add('update:song');
      grantedPermissions.add('delete:song');
      grantedPermissions.add('read:song');
      grantedPermissions.add('create:album');
      grantedPermissions.add('update:album');
      grantedPermissions.add('delete:album');
      grantedPermissions.add('read:album');
      grantedPermissions.add('create:artist');
      grantedPermissions.add('update:artist');
      grantedPermissions.add('read:artist');
      grantedPermissions.add('create:genre');
      grantedPermissions.add('read:genre');
      grantedPermissions.add('upload:file');
    }

    // Rôle AUTHOR : livres audio, chapitres
    if (systemRoles.includes('AUTHOR') || systemRoles.includes('AUTEUR')) {
      grantedPermissions.add('create:audiobook');
      grantedPermissions.add('update:audiobook');
      grantedPermissions.add('delete:audiobook');
      grantedPermissions.add('read:audiobook');
      grantedPermissions.add('create:chapter');
      grantedPermissions.add('update:chapter');
      grantedPermissions.add('delete:chapter');
      grantedPermissions.add('read:chapter');
      grantedPermissions.add('upload:file');
    }

    // Rôle CREATOR : vidéos, playlists vidéo
    if (systemRoles.includes('CREATOR') || systemRoles.includes('CREATEUR')) {
      grantedPermissions.add('create:video');
      grantedPermissions.add('update:video');
      grantedPermissions.add('delete:video');
      grantedPermissions.add('read:video');
      grantedPermissions.add('create:video-playlist');
      grantedPermissions.add('update:video-playlist');
      grantedPermissions.add('delete:video-playlist');
      grantedPermissions.add('read:video-playlist');
      grantedPermissions.add('upload:file');
    }

    // Permissions explicites attachées au rôle SQL
    if (userWithPerms.role?.permissions) {
      for (const p of userWithPerms.role.permissions) {
        grantedPermissions.add(`${p.action}:${p.resource}`);
      }
    }

    const hasPermission = requiredPermissions.every((perm) =>
      grantedPermissions.has(perm),
    );

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
