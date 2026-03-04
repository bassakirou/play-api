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
exports.ArtistGroupsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ArtistGroupsService = class ArtistGroupsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    create(dto) {
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
    findOne(id) {
        return this.prisma.artistGroup.findUnique({
            where: { id },
            include: { members: true },
        });
    }
    update(id, dto) {
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
    remove(id) {
        return this.prisma.artistGroup.delete({ where: { id } });
    }
};
exports.ArtistGroupsService = ArtistGroupsService;
exports.ArtistGroupsService = ArtistGroupsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ArtistGroupsService);
//# sourceMappingURL=artist-groups.service.js.map