"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArtistGroupsModule = void 0;
const common_1 = require("@nestjs/common");
const artist_groups_service_1 = require("./artist-groups.service");
const artist_groups_controller_1 = require("./artist-groups.controller");
const prisma_module_1 = require("../prisma/prisma.module");
const passport_1 = require("@nestjs/passport");
let ArtistGroupsModule = class ArtistGroupsModule {
};
exports.ArtistGroupsModule = ArtistGroupsModule;
exports.ArtistGroupsModule = ArtistGroupsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, passport_1.PassportModule],
        controllers: [artist_groups_controller_1.ArtistGroupsController],
        providers: [artist_groups_service_1.ArtistGroupsService],
    })
], ArtistGroupsModule);
//# sourceMappingURL=artist-groups.module.js.map