export type MinioConfig = {
    endPoint?: string;
    port?: number;
    useSSL?: boolean;
    accessKey?: string;
    secretKey?: string;
    publicUrl?: string;
    buckets?: {
        audio?: string;
        images?: string;
        videos?: string;
    };
};
export declare class MinioService {
    private client;
    private cfg;
    constructor(cfg?: MinioConfig);
    isEnabled(): boolean;
    ensureBucket(name: string): Promise<void>;
    upload(opts: {
        bucket: 'audio' | 'images' | 'videos';
        objectName: string;
        buffer: Buffer;
        contentType?: string;
    }): Promise<{
        bucket: string;
        objectName: string;
        url: string;
    }>;
    presignGet(opts: {
        bucket: 'audio' | 'images' | 'videos';
        objectName: string;
        contentType?: string;
        expiresSeconds?: number;
    }): Promise<string>;
}
