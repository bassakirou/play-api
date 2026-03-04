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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const client_1 = require("@prisma/client");
const bcrypt = require("bcryptjs");
let UsersService = class UsersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createUserDto) {
        const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
        const roleName = (createUserDto.role || 'USER').toUpperCase();
        let role = await this.prisma.role.findUnique({ where: { name: roleName } });
        if (!role) {
            role = await this.prisma.role.create({ data: { name: roleName } });
        }
        try {
            const created = await this.prisma.user.create({
                data: {
                    email: createUserDto.email,
                    password: hashedPassword,
                    name: createUserDto.name,
                    roleId: role.id,
                },
            });
            if (roleName === 'CREATOR') {
                const existingArtist = await this.prisma.artist.findUnique({
                    where: { userId: created.id },
                });
                if (!existingArtist) {
                    await this.prisma.artist.create({
                        data: {
                            name: created.name,
                            userId: created.id,
                        },
                    });
                }
            }
            return created;
        }
        catch (err) {
            const code = err?.code;
            if (code === 'P2002') {
                throw new common_1.BadRequestException('Email already exists');
            }
            if (code === 'P2003') {
                throw new common_1.BadRequestException('Invalid role');
            }
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                throw new common_1.BadRequestException(err.message);
            }
            throw err;
        }
    }
    findAll() {
        return this.prisma.user.findMany({
            include: { role: true, artistProfile: true },
        });
    }
    findOne(id) {
        return this.prisma.user.findUnique({
            where: { id },
            include: { role: true, artistProfile: true, favorites: true },
        });
    }
    findByEmail(email) {
        return this.prisma.user.findUnique({
            where: { email },
            include: { role: true },
        });
    }
    findByResetToken(token) {
        return this.prisma.user.findFirst({
            where: { resetToken: token },
        });
    }
    update(id, updateUserDto) {
        return this.prisma.user.update({
            where: { id },
            data: updateUserDto,
        });
    }
    remove(id) {
        return this.prisma.user.delete({ where: { id } });
    }
    async addFavorite(userId, songId) {
        const song = await this.prisma.song.findUnique({ where: { id: songId } });
        if (!song) {
            throw new common_1.NotFoundException('Song not found');
        }
        return this.prisma.user.update({
            where: { id: userId },
            data: {
                favorites: {
                    connect: { id: songId },
                },
            },
            include: { favorites: true },
        });
    }
    async removeFavorite(userId, songId) {
        return this.prisma.user.update({
            where: { id: userId },
            data: {
                favorites: {
                    disconnect: { id: songId },
                },
            },
            include: { favorites: true },
        });
    }
    async getFavorites(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { favorites: { include: { artists: true, album: true } } },
        });
        return user?.favorites || [];
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UsersService);
//# sourceMappingURL=users.service.js.map