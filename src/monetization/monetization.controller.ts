import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Req,
} from '@nestjs/common';
import { MonetizationService } from './monetization.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  UpdateMonetizationConfigDto,
  CreateGiftCatalogDto,
  UpdateGiftCatalogDto,
  InitiatePurchaseDto,
  SendGiftDto,
  SubscribeAcademicDto,
  CreateWithdrawalRequestDto,
  ReviewWithdrawalDto,
} from './dto/monetization.dto';

@Controller('monetization')
export class MonetizationController {
  constructor(private readonly monetizationService: MonetizationService) {}

  @UseGuards(JwtAuthGuard)
  @Get('admin/config')
  async getConfig(@Request() req: any) {
    return this.monetizationService.getConfig();
  }

  @UseGuards(JwtAuthGuard)
  @Put('admin/config')
  async updateConfig(@Request() req: any, @Body() dto: UpdateMonetizationConfigDto) {
    return this.monetizationService.updateConfig(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/stats')
  async getAdminStats(@Request() req: any) {
    return this.monetizationService.getAdminStats();
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/withdrawals')
  async getAllWithdrawals(@Request() req: any, @Query('status') status?: string) {
    return this.monetizationService.getAllWithdrawalRequests(status);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/withdrawals/:id/review')
  async reviewWithdrawal(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ReviewWithdrawalDto,
  ) {
    return this.monetizationService.reviewWithdrawal(id, req.user.id, dto);
  }

  @Get('gifts/catalog')
  async getPublicGiftCatalog() {
    await this.monetizationService.seedDefaultAfricanGifts();
    return this.monetizationService.getGiftCatalog(true);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/gifts')
  async getAdminGiftCatalog() {
    await this.monetizationService.seedDefaultAfricanGifts();
    return this.monetizationService.getGiftCatalog(false);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/gifts')
  async createGiftItem(@Body() dto: CreateGiftCatalogDto) {
    return this.monetizationService.createGiftItem(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Put('admin/gifts/:id')
  async updateGiftItem(@Param('id') id: string, @Body() dto: UpdateGiftCatalogDto) {
    return this.monetizationService.updateGiftItem(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('admin/gifts/:id')
  async deleteGiftItem(@Param('id') id: string) {
    return this.monetizationService.deleteGiftItem(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('purchase')
  async initiatePurchase(@Request() req: any, @Body() dto: InitiatePurchaseDto) {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3022';
    const hostBaseUrl = protocol + '://' + host;
    return this.monetizationService.initiatePurchase(req.user.id, dto, hostBaseUrl);
  }

  @Post('gifts/send')
  async sendGift(@Req() req: any, @Body() dto: SendGiftDto) {
    const userId = req.user?.id || null;
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3022';
    const hostBaseUrl = protocol + '://' + host;
    return this.monetizationService.sendGift(userId, dto, hostBaseUrl);
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscribe/academic')
  async subscribeAcademic(@Request() req: any, @Body() dto: SubscribeAcademicDto) {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3022';
    const hostBaseUrl = protocol + '://' + host;
    return this.monetizationService.subscribeAcademic(req.user.id, dto, hostBaseUrl);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-purchases')
  async getMyPurchases(@Request() req: any) {
    return this.monetizationService.getUserPurchasedContents(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('creator/summary')
  async getCreatorSummary(@Request() req: any) {
    return this.monetizationService.getCreatorMonetizationSummary(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('creator/withdraw')
  async requestWithdrawal(@Request() req: any, @Body() dto: CreateWithdrawalRequestDto) {
    return this.monetizationService.requestWithdrawal(req.user.id, dto);
  }

  @Post('webhook/tara')
  async handleTaraWebhook(@Body() body: any) {
    return this.monetizationService.handleTaraWebhook(body);
  }

  @Get('transaction/:id/status')
  async getTransactionStatus(@Param('id') id: string) {
    return this.monetizationService.getTransactionStatus(id);
  }
}
