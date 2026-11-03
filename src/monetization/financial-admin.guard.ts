import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { MonetizationService } from './monetization.service';

@Injectable()
export class FinancialAdminGuard implements CanActivate {
  constructor(private readonly monetization: MonetizationService) {}
  async canActivate(context: ExecutionContext) {
    const userId = context.switchToHttp().getRequest().user?.id;
    if (!userId || !(await this.monetization.isAdmin(userId))) throw new ForbiddenException('Administration financière réservée.');
    return true;
  }
}
