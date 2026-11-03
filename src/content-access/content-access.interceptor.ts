import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { mergeMap } from 'rxjs/operators';
import { verify } from 'jsonwebtoken';
import { ContentAccessService } from './content-access.service';

@Injectable()
export class ContentAccessInterceptor implements NestInterceptor {
  constructor(private readonly access: ContentAccessService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    let caller = req.user;
    if (!caller && /^Bearer /i.test(req.headers.authorization || '')) {
      try {
        const payload: any = verify(
          req.headers.authorization.slice(7),
          process.env.JWT_SECRET || 'secretKey',
        );
        caller = { id: payload.sub };
      } catch {
        /* Invalid credentials never receive protected content. */
      }
    }
    context
      .switchToHttp()
      .getResponse()
      .setHeader('Cache-Control', 'private, no-store');
    const baseUrl =
      process.env.PUBLIC_API_URL?.replace(/\/$/, '') ||
      `${req.protocol}://${req.get('host')}`;
    return next
      .handle()
      .pipe(mergeMap((data) => this.access.sanitize(data, caller, baseUrl)));
  }
}
