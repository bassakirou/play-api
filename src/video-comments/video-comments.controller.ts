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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { VideoCommentsService } from './video-comments.service';
import { CreateVideoCommentDto, QueryStudioCommentsDto } from './dto/video-comment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('video-comments')
@Controller()
export class VideoCommentsController {
  constructor(private readonly videoCommentsService: VideoCommentsService) {}

  /**
   * Récupérer tous les commentaires hiérarchiques d'une vidéo
   */
  @Get('videos/:videoId/comments')
  findByVideo(@Param('videoId') videoId: string) {
    return this.videoCommentsService.findByVideo(videoId);
  }

  /**
   * Ajouter un commentaire ou une réponse à un commentaire
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('videos/:videoId/comments')
  create(
    @Param('videoId') videoId: string,
    @Req() req: any,
    @Body() dto: CreateVideoCommentDto,
  ) {
    const userId = req.user?.userId || req.user?.id;
    return this.videoCommentsService.create(videoId, userId, dto);
  }

  /**
   * Aimer / liker un commentaire
   */
  @Patch('video-comments/:id/like')
  like(@Param('id') id: string) {
    return this.videoCommentsService.like(id);
  }

  /**
   * Supprimer un commentaire
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('video-comments/:id')
  delete(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.userId || req.user?.id;
    const rawRole = req.user?.role;
    const roleName = typeof rawRole === 'string' ? rawRole : rawRole?.name || '';
    const userRoles = [
      roleName,
      ...(req.user?.systemRoles || []),
    ];
    return this.videoCommentsService.delete(id, userId, userRoles);
  }

  /**
   * Creator Studio : Lister l'ensemble des commentaires reçus sur les vidéos du créateur
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('studio/comments')
  findForStudio(@Req() req: any, @Query() query: QueryStudioCommentsDto) {
    const creatorUserId = req.user?.userId || req.user?.id;
    return this.videoCommentsService.findForStudio(creatorUserId, query);
  }

  /**
   * Creator Studio : Répondre directement à un commentaire depuis le tableau de bord Studio
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('studio/comments/:id/reply')
  replyFromStudio(
    @Param('id') id: string,
    @Req() req: any,
    @Body('content') content: string,
  ) {
    const creatorUserId = req.user?.userId || req.user?.id;
    return this.videoCommentsService.replyFromStudio(id, creatorUserId, content || '');
  }
}
