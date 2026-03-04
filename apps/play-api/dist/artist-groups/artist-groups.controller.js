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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArtistGroupsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const artist_groups_service_1 = require("./artist-groups.service");
const create_artist_group_dto_1 = require("./dto/create-artist-group.dto");
let ArtistGroupsController = class ArtistGroupsController {
    artistGroupsService;
    constructor(artistGroupsService) {
        this.artistGroupsService = artistGroupsService;
    }
    create(dto) {
        return this.artistGroupsService.create(dto);
    }
    findAll() {
        return this.artistGroupsService.findAll();
    }
    findOne(id) {
        return this.artistGroupsService.findOne(id);
    }
    update(id, dto) {
        return this.artistGroupsService.update(id, dto);
    }
    remove(id) {
        return this.artistGroupsService.remove(id);
    }
};
exports.ArtistGroupsController = ArtistGroupsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_artist_group_dto_1.CreateArtistGroupDto]),
    __metadata("design:returntype", void 0)
], ArtistGroupsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ArtistGroupsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ArtistGroupsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_artist_group_dto_1.CreateArtistGroupDto]),
    __metadata("design:returntype", void 0)
], ArtistGroupsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ArtistGroupsController.prototype, "remove", null);
exports.ArtistGroupsController = ArtistGroupsController = __decorate([
    (0, swagger_1.ApiTags)('artist-groups'),
    (0, common_1.Controller)('artist-groups'),
    __metadata("design:paramtypes", [artist_groups_service_1.ArtistGroupsService])
], ArtistGroupsController);
//# sourceMappingURL=artist-groups.controller.js.map