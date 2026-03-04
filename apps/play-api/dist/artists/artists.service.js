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
exports.ArtistsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ArtistsService = class ArtistsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createArtistDto, user) {
        if (user.role === 'CREATOR') {
            const existing = await this.prisma.artist.findUnique({
                where: { userId: user.userId },
            });
            if (existing) {
                throw new common_1.ForbiddenException('You already have an artist profile');
            }
            return this.prisma.artist.create({
                data: {
                    ...createArtistDto,
                    userId: user.userId,
                },
            });
        }
        else if (user.role === 'LABEL') {
            return this.prisma.artist.create({
                data: {
                    ...createArtistDto,
                    labelId: user.userId,
                },
            });
        }
        else if (user.role === 'ADMIN') {
            return this.prisma.artist.create({
                data: {
                    ...createArtistDto,
                },
            });
        }
        throw new common_1.ForbiddenException('Not authorized to create artist');
    }
    findAll() {
        return this.prisma.artist.findMany({
            include: { albums: true, songs: true },
        });
    }
    findCreators() {
        return this.prisma.artist.findMany({
            where: { user: { role: { name: 'CREATOR' } } },
            include: { user: true },
        });
    }
    findOne(id) {
        return this.prisma.artist.findUnique({
            where: { id },
            include: { albums: true, songs: true },
        });
    }
    update(id, updateArtistDto, user) {
        return this.prisma.artist.update({
            where: { id },
            data: updateArtistDto,
        });
    }
    remove(id) {
        return this.prisma.artist.delete({ where: { id } });
    }
};
exports.ArtistsService = ArtistsService;
exports.ArtistsService = ArtistsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ArtistsService);
//# sourceMappingURL=artists.service.js.map