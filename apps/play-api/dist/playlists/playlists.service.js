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
exports.PlaylistsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let PlaylistsService = class PlaylistsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    includeRelations = {
        songs: {
            include: {
                artists: true,
                album: true,
                genre: true,
            },
        },
    };
    async findMine(userId) {
        return this.prisma.playlist.findMany({
            where: { userId },
            include: this.includeRelations,
            orderBy: { createdAt: 'desc' },
        });
    }
    async create(userId, name) {
        return this.prisma.playlist.create({
            data: { name, userId },
            include: this.includeRelations,
        });
    }
    async delete(userId, playlistId) {
        const playlist = await this.prisma.playlist.findFirst({
            where: { id: playlistId, userId },
        });
        if (!playlist) {
            throw new common_1.NotFoundException('Playlist not found');
        }
        await this.prisma.playlist.delete({ where: { id: playlistId } });
        return { success: true };
    }
    async addSong(userId, playlistId, songId) {
        const playlist = await this.prisma.playlist.findFirst({
            where: { id: playlistId, userId },
        });
        if (!playlist) {
            throw new common_1.NotFoundException('Playlist not found');
        }
        return this.prisma.playlist.update({
            where: { id: playlistId },
            data: { songs: { connect: { id: songId } } },
            include: this.includeRelations,
        });
    }
    async removeSong(userId, playlistId, songId) {
        const playlist = await this.prisma.playlist.findFirst({
            where: { id: playlistId, userId },
        });
        if (!playlist) {
            throw new common_1.NotFoundException('Playlist not found');
        }
        return this.prisma.playlist.update({
            where: { id: playlistId },
            data: { songs: { disconnect: { id: songId } } },
            include: this.includeRelations,
        });
    }
};
exports.PlaylistsService = PlaylistsService;
exports.PlaylistsService = PlaylistsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PlaylistsService);
//# sourceMappingURL=playlists.service.js.map