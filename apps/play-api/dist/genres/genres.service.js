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
exports.GenresService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let GenresService = class GenresService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async onModuleInit() {
        const defaults = [
            'Afrobeat',
            'Amapiano',
            'Hip-Hop',
            'Rap',
            'R&B',
            'Soul',
            'Jazz',
            'Gospel',
            'Pop',
            'Rock',
            'Reggae',
            'Dancehall',
            'Electro',
            'Classique',
            'Traditional',
        ];
        for (const name of defaults) {
            const exists = await this.prisma.genre.findUnique({ where: { name } });
            if (!exists) {
                await this.prisma.genre.create({ data: { name, isSystem: true } });
            }
        }
    }
    async create(createGenreDto, user) {
        const isSystem = user.role === 'ADMIN';
        return this.prisma.genre.create({
            data: {
                ...createGenreDto,
                createdById: user.userId,
                isSystem,
            },
        });
    }
    findAll() {
        return this.prisma.genre.findMany();
    }
    findOne(id) {
        return this.prisma.genre.findUnique({ where: { id } });
    }
    async update(id, updateGenreDto, user) {
        const genre = await this.prisma.genre.findUnique({ where: { id } });
        if (!genre)
            return null;
        if (user.role === 'ADMIN') {
            return this.prisma.genre.update({ where: { id }, data: updateGenreDto });
        }
        if (genre.isSystem) {
            throw new common_1.ForbiddenException('Cannot modify system genre');
        }
        if (genre.createdById !== user.userId) {
            throw new common_1.ForbiddenException('Cannot modify genre created by another user');
        }
        return this.prisma.genre.update({ where: { id }, data: updateGenreDto });
    }
    async remove(id, user) {
        const genre = await this.prisma.genre.findUnique({ where: { id } });
        if (!genre)
            return null;
        if (user.role === 'ADMIN') {
            return this.prisma.genre.delete({ where: { id } });
        }
        if (genre.isSystem) {
            throw new common_1.ForbiddenException('Cannot delete system genre');
        }
        if (genre.createdById !== user.userId) {
            throw new common_1.ForbiddenException('Cannot delete genre created by another user');
        }
        return this.prisma.genre.delete({ where: { id } });
    }
};
exports.GenresService = GenresService;
exports.GenresService = GenresService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GenresService);
//# sourceMappingURL=genres.service.js.map