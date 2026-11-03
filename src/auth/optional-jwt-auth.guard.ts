import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, _info: any, context: any) {
    if (context.switchToHttp().getRequest().headers.authorization && (err || !user)) {
      throw new UnauthorizedException();
    }
    return user || undefined;
  }
}
