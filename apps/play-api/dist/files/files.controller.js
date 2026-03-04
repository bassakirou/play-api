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
exports.FilesController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const path_1 = require("path");
const crypto_1 = require("crypto");
const swagger_1 = require("@nestjs/swagger");
const minio_service_1 = require("../storage/minio.service");
const fs_1 = require("fs");
function ensureDir(path) {
    if (!(0, fs_1.existsSync)(path)) {
        (0, fs_1.mkdirSync)(path, { recursive: true });
    }
}
function diskAudioStorage() {
    return (0, multer_1.diskStorage)({
        destination: (_req, _file, cb) => {
            const dest = (0, path_1.join)(process.cwd(), 'uploads', 'audio');
            ensureDir(dest);
            cb(null, dest);
        },
        filename: (_req, file, cb) => {
            const unique = (0, crypto_1.randomBytes)(8).toString('hex');
            cb(null, `${Date.now()}-${unique}${(0, path_1.extname)(file.originalname)}`);
        },
    });
}
let FilesController = class FilesController {
    minio;
    constructor(minio) {
        this.minio = minio;
    }
    async resolvedImage(url, res) {
        if (!url) {
            res.status(400).send('Missing url');
            return;
        }
        try {
            if (this.minio.isEnabled()) {
                const match = url.match(/\/images\/(.+)$/);
                if (match && match[1]) {
                    const objectName = match[1];
                    const signed = await this.minio.presignGet({
                        bucket: 'images',
                        objectName,
                        contentType: 'image/*',
                    });
                    res.redirect(signed);
                    return;
                }
            }
            res.redirect(url);
        }
        catch {
            res.redirect(url);
        }
    }
    async uploadAudio(file) {
        if (!file)
            return { error: 'No file' };
        if (this.minio.isEnabled()) {
            const objectName = `${Date.now()}-${(0, crypto_1.randomBytes)(6).toString('hex')}${(0, path_1.extname)(file.originalname)}`;
            try {
                return await this.minio.upload({
                    bucket: 'audio',
                    objectName,
                    buffer: file.buffer,
                    contentType: file.mimetype,
                });
            }
            catch { }
        }
        if (!file.filename && file.buffer) {
            const dest = (0, path_1.join)(process.cwd(), 'uploads', 'audio');
            ensureDir(dest);
            const filename = `${Date.now()}-${(0, crypto_1.randomBytes)(8).toString('hex')}${(0, path_1.extname)(file.originalname)}`;
            (0, fs_1.writeFileSync)((0, path_1.join)(dest, filename), file.buffer);
            const url = `/uploads/audio/${filename}`;
            return { url, filename };
        }
        const url = `/uploads/audio/${file.filename}`;
        return { url, filename: file.filename };
    }
    async uploadImage(file) {
        if (!file)
            return { error: 'No file' };
        if (this.minio.isEnabled()) {
            const objectName = `${Date.now()}-${(0, crypto_1.randomBytes)(6).toString('hex')}${(0, path_1.extname)(file.originalname)}`;
            try {
                return await this.minio.upload({
                    bucket: 'images',
                    objectName,
                    buffer: file.buffer,
                    contentType: file.mimetype,
                });
            }
            catch { }
        }
        if (!file.filename && file.buffer) {
            const dest = (0, path_1.join)(process.cwd(), 'uploads', 'images');
            ensureDir(dest);
            const filename = `${Date.now()}-${(0, crypto_1.randomBytes)(8).toString('hex')}${(0, path_1.extname)(file.originalname)}`;
            (0, fs_1.writeFileSync)((0, path_1.join)(dest, filename), file.buffer);
            const url = `/uploads/images/${filename}`;
            return { url, filename };
        }
        const url = `/uploads/images/${file.filename}`;
        return { url, filename: file.filename };
    }
    async resolvedAudio(url, res) {
        if (!url) {
            res.status(400).send('Missing url');
            return;
        }
        try {
            if (this.minio.isEnabled()) {
                const match = url.match(/\/audio\/(.+)$/);
                if (match && match[1]) {
                    const objectName = match[1];
                    const signed = await this.minio.presignGet({
                        bucket: 'audio',
                        objectName,
                        contentType: 'audio/mpeg',
                    });
                    res.redirect(signed);
                    return;
                }
            }
            res.redirect(url);
        }
        catch {
            res.redirect(url);
        }
    }
};
exports.FilesController = FilesController;
__decorate([
    (0, common_1.Get)('resolved-image'),
    __param(0, (0, common_1.Query)('url')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "resolvedImage", null);
__decorate([
    (0, common_1.Post)('upload-audio'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', process.env.MINIO_ENDPOINT
        ? { storage: (0, multer_1.memoryStorage)(), limits: { fileSize: 1024 * 1024 * 100 } }
        : {
            storage: diskAudioStorage(),
            limits: { fileSize: 1024 * 1024 * 100 },
        })),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({
        schema: {
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' } },
        },
    }),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "uploadAudio", null);
__decorate([
    (0, common_1.Post)('upload-image'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', process.env.MINIO_ENDPOINT
        ? {
            storage: (0, multer_1.memoryStorage)(),
            limits: { fileSize: 1024 * 1024 * 20 },
        }
        : {
            storage: (0, multer_1.diskStorage)({
                destination: (_req, _file, cb) => {
                    const dest = (0, path_1.join)(process.cwd(), 'uploads', 'images');
                    ensureDir(dest);
                    cb(null, dest);
                },
                filename: (_req, file, cb) => {
                    const unique = (0, crypto_1.randomBytes)(8).toString('hex');
                    cb(null, `${Date.now()}-${unique}${(0, path_1.extname)(file.originalname)}`);
                },
            }),
            limits: { fileSize: 1024 * 1024 * 20 },
        })),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({
        schema: {
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' } },
        },
    }),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "uploadImage", null);
__decorate([
    (0, common_1.Get)('resolved-audio'),
    __param(0, (0, common_1.Query)('url')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "resolvedAudio", null);
exports.FilesController = FilesController = __decorate([
    (0, swagger_1.ApiTags)('files'),
    (0, common_1.Controller)('files'),
    __metadata("design:paramtypes", [minio_service_1.MinioService])
], FilesController);
//# sourceMappingURL=files.controller.js.map