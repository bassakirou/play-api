/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { LivesService } from './lives.service';
import { CreateLiveDto, UpdateLiveDto, AddCommentDto, AddReactionDto } from './dto/live.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('lives')
export class LivesController {
  constructor(private readonly livesService: LivesService) {}

  @Get()
  findAll(
    @Query('category') category?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.livesService.findAll({ category, type, status, search });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.livesService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Request() req: any, @Body() dto: CreateLiveDto) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.livesService.create(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: UpdateLiveDto,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const isAdmin = req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
    return this.livesService.update(id, userId, dto, isAdmin);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/start')
  startLive(@Param('id') id: string, @Request() req: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const isAdmin = req.user?.role === 'ADMIN';
    return this.livesService.startLive(id, userId, isAdmin);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/end')
  endLive(@Param('id') id: string, @Request() req: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const isAdmin = req.user?.role === 'ADMIN';
    return this.livesService.endLive(id, userId, isAdmin);
  }

  @Post(':id/comments')
  addComment(
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
    @Request() req: any,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub || null;
    return this.livesService.addComment(id, userId, dto);
  }

  @Post(':id/reactions')
  addReaction(@Param('id') id: string, @Body() dto: AddReactionDto) {
    return this.livesService.addReaction(id, dto.emoji);
  }

  @Post(':id/heartbeat')
  heartbeat(@Param('id') id: string, @Body() body: { viewerCount?: number }) {
    if (body.viewerCount !== undefined) {
      return this.livesService.updateViewerCount(id, body.viewerCount);
    }
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const isAdmin = req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
    return this.livesService.deleteLive(id, userId, isAdmin);
  }

  @UseGuards(JwtAuthGuard)
  @Post('cleanup')
  manualCleanup(@Request() req: any) {
    const isAdmin = req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
    if (!isAdmin) {
      throw new ForbiddenException('Seul un administrateur peut déclencher la purge manuelle.');
    }
    return this.livesService.cleanupExpiredLives();
  }
}
