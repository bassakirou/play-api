"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SongsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let SongsService = class SongsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    create(createSongDto) {
        const dto = createSongDto;
        const { artistIds, groupIds, artistId, isSingle, albumId, coverUrl, ...rest } = dto;
        const finalArtistIds = Array.isArray(artistIds)
            ? artistIds
            : artistId
                ? [artistId]
                : [];
        if (typeof isSingle !== 'boolean') {
            throw new common_1.BadRequestException('isSingle is required');
        }
        if (isSingle) {
            if (!coverUrl) {
                throw new common_1.BadRequestException('coverUrl is required for singles');
            }
            if (albumId) {
                throw new common_1.BadRequestException('Single cannot be linked to an album');
            }
        }
        else {
            if (!albumId) {
                throw new common_1.BadRequestException('albumId is required for album tracks');
            }
        }
        const data = {
            ...rest,
            isSingle,
            coverUrl: coverUrl || null,
            albumId: isSingle ? null : albumId,
            artists: { connect: finalArtistIds.map((id) => ({ id })) },
            ...(groupIds && groupIds.length
                ? { groups: { connect: groupIds.map((id) => ({ id })) } }
                : {}),
        };
        return this.prisma.song.create({
            data,
        });
    }
    findAll() {
        return this.prisma.song.findMany({
            include: { artists: true, groups: true, album: true, genre: true },
        });
    }
    findOne(id) {
        return this.prisma.song.findUnique({
            where: { id },
            include: { artists: true, groups: true, album: true, genre: true },
        });
    }
    update(id, updateSongDto) {
        const { artistIds, groupIds, isSingle, albumId, coverUrl, ...rest } = updateSongDto || {};
        const data = { ...rest };
        if (typeof isSingle === 'boolean') {
            data.isSingle = isSingle;
            if (isSingle) {
                if (!coverUrl) {
                    throw new common_1.BadRequestException('coverUrl is required for singles');
                }
                data.coverUrl = coverUrl;
                data.albumId = null;
            }
            else {
                if (!albumId) {
                    throw new common_1.BadRequestException('albumId is required for album tracks');
                }
                data.albumId = albumId;
                if (typeof coverUrl !== 'undefined') {
                    data.coverUrl = coverUrl || null;
                }
            }
        }
        else {
            if (typeof albumId !== 'undefined') {
                data.albumId = albumId;
            }
            if (typeof coverUrl !== 'undefined') {
                data.coverUrl = coverUrl || null;
            }
        }
        const updateData = {
            ...data,
            ...(artistIds
                ? { artists: { set: artistIds.map((aid) => ({ id: aid })) } }
                : {}),
            ...(groupIds
                ? { groups: { set: groupIds.map((gid) => ({ id: gid })) } }
                : {}),
        };
        return this.prisma.song.update({
            where: { id },
            data: updateData,
        });
    }
    async remove(id) {
        const song = await this.prisma.song.findUnique({
            where: { id },
            include: { album: true },
        });
        if (!song) {
            throw new common_1.BadRequestException('Song not found');
        }
        const albumId = song.albumId || null;
        const album = song.album;
        await this.prisma.song.delete({ where: { id } });
        let albumDeleted = null;
        if (albumId) {
            const count = await this.prisma.song.count({ where: { albumId } });
            if (count === 0) {
                await this.prisma.album.delete({ where: { id: albumId } });
                albumDeleted = album;
            }
        }
        return { ok: true, albumDeleted };
    }
};
exports.SongsService = SongsService;
exports.SongsService = SongsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SongsService);
//# sourceMappingURL=songs.service.js.map