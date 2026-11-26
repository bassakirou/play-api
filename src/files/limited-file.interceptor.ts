import { CallHandler, ExecutionContext, Injectable, mixin, NestInterceptor, PayloadTooLargeException, Type } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageUploadKind, MediaUploadSettingsService, UploadKind } from './media-upload-settings';

export function LimitedFileInterceptor(kind: UploadKind, options: Parameters<typeof FileInterceptor>[1]): Type<NestInterceptor> {
  @Injectable()
  class LimitedFile implements NestInterceptor {
    constructor(private readonly settings: MediaUploadSettingsService) {}

    async intercept(context: ExecutionContext, next: CallHandler) {
      const request = context.switchToHttp().getRequest();
      const actualKind = kind === 'image' ? imageUploadKind(request.query?.purpose) : kind;
      const limit = await this.settings.limit(actualKind);
      // Busboy rejects when the byte count reaches its limit. Allow the exact configured size.
      const Interceptor = FileInterceptor('file', { ...options, limits: { fileSize: limit.bytes + 1 } });
      try {
        return await new Interceptor().intercept(context, next);
      } catch (error) {
        if (error instanceof PayloadTooLargeException) throw new PayloadTooLargeException(limit.message);
        throw error;
      }
    }
  }
  return mixin(LimitedFile);
}
