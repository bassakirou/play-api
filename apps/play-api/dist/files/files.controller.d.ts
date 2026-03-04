import { MinioService } from '../storage/minio.service';
export declare class FilesController {
    private readonly minio;
    constructor(minio: MinioService);
    resolvedImage(url: string, res: any): Promise<void>;
    uploadAudio(file?: Express.Multer.File): Promise<{
        bucket: string;
        objectName: string;
        url: string;
    } | {
        error: string;
        url?: undefined;
        filename?: undefined;
    } | {
        url: string;
        filename: string;
        error?: undefined;
    }>;
    uploadImage(file?: Express.Multer.File): Promise<{
        bucket: string;
        objectName: string;
        url: string;
    } | {
        error: string;
        url?: undefined;
        filename?: undefined;
    } | {
        url: string;
        filename: string;
        error?: undefined;
    }>;
    resolvedAudio(url: string, res: any): Promise<void>;
}
