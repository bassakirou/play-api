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
exports.MinioService = void 0;
const common_1 = require("@nestjs/common");
const minio_1 = require("minio");
let MinioService = class MinioService {
    client = null;
    cfg;
    constructor(cfg) {
        this.cfg = cfg || {
            endPoint: process.env.MINIO_ENDPOINT,
            port: process.env.MINIO_PORT ? Number(process.env.MINIO_PORT) : undefined,
            useSSL: process.env.MINIO_USE_SSL === 'true',
            accessKey: process.env.MINIO_ACCESS_KEY,
            secretKey: process.env.MINIO_SECRET_KEY,
            publicUrl: process.env.MINIO_PUBLIC_URL,
            buckets: {
                audio: process.env.MINIO_BUCKET_AUDIO || 'audio',
                images: process.env.MINIO_BUCKET_IMAGES || 'images',
                videos: process.env.MINIO_BUCKET_VIDEOS || 'videos',
            },
        };
        if (this.cfg.endPoint && this.cfg.accessKey && this.cfg.secretKey) {
            this.client = new minio_1.Client({
                endPoint: this.cfg.endPoint,
                port: this.cfg.port,
                useSSL: this.cfg.useSSL,
                accessKey: this.cfg.accessKey,
                secretKey: this.cfg.secretKey,
            });
        }
    }
    isEnabled() {
        return !!this.client;
    }
    async ensureBucket(name) {
        if (!this.client)
            return;
        const exists = await this.client.bucketExists(name).catch(() => false);
        if (!exists) {
            await this.client.makeBucket(name).catch(() => undefined);
        }
    }
    async upload(opts) {
        if (!this.client) {
            throw new Error('MinIO not configured');
        }
        const bucketName = this.cfg.buckets?.[opts.bucket] || opts.bucket;
        await this.ensureBucket(bucketName);
        await this.client.putObject(bucketName, opts.objectName, opts.buffer, opts.buffer.length, {
            'Content-Type': opts.contentType || 'application/octet-stream',
        });
        const url = await this.client.presignedGetObject(bucketName, opts.objectName, 60 * 60 * 24 * 7, opts.contentType
            ? { 'response-content-type': opts.contentType }
            : undefined);
        return { bucket: bucketName, objectName: opts.objectName, url };
    }
    async presignGet(opts) {
        if (!this.client) {
            throw new Error('MinIO not configured');
        }
        const bucketName = this.cfg.buckets?.[opts.bucket] || opts.bucket;
        await this.ensureBucket(bucketName);
        const url = await this.client.presignedGetObject(bucketName, opts.objectName, opts.expiresSeconds ?? 60 * 60 * 24 * 7, opts.contentType
            ? { 'response-content-type': opts.contentType }
            : undefined);
        return url;
    }
};
exports.MinioService = MinioService;
exports.MinioService = MinioService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [Object])
], MinioService);
//# sourceMappingURL=minio.service.js.map