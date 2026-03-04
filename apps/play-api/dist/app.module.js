"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const prisma_module_1 = require("./prisma/prisma.module");
const users_module_1 = require("./users/users.module");
const roles_module_1 = require("./roles/roles.module");
const artists_module_1 = require("./artists/artists.module");
const albums_module_1 = require("./albums/albums.module");
const songs_module_1 = require("./songs/songs.module");
const genres_module_1 = require("./genres/genres.module");
const permissions_module_1 = require("./permissions/permissions.module");
const health_controller_1 = require("./health.controller");
const files_controller_1 = require("./files/files.controller");
const minio_service_1 = require("./storage/minio.service");
const auth_module_1 = require("./auth/auth.module");
const artist_groups_module_1 = require("./artist-groups/artist-groups.module");
const mail_module_1 = require("./mail/mail.module");
const playlists_module_1 = require("./playlists/playlists.module");
const search_module_1 = require("./search/search.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            prisma_module_1.PrismaModule,
            auth_module_1.AuthModule,
            mail_module_1.MailModule,
            users_module_1.UsersModule,
            roles_module_1.RolesModule,
            artists_module_1.ArtistsModule,
            artist_groups_module_1.ArtistGroupsModule,
            albums_module_1.AlbumsModule,
            songs_module_1.SongsModule,
            genres_module_1.GenresModule,
            permissions_module_1.PermissionsModule,
            playlists_module_1.PlaylistsModule,
            search_module_1.SearchModule,
        ],
        controllers: [app_controller_1.AppController, health_controller_1.HealthController, files_controller_1.FilesController],
        providers: [app_service_1.AppService, minio_service_1.MinioService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map