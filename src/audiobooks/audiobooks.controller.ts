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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AudiobooksService } from './audiobooks.service';
import { CreateAudiobookDto } from './dto/create-audiobook.dto';
import { UpdateAudiobookDto } from './dto/update-audiobook.dto';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('audiobooks')
@Controller('audiobooks')
export class AudiobooksController {
  constructor(private readonly audiobooksService: AudiobooksService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les livres audio avec filtres optionnels' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'isTrending', required: false, type: Boolean })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'authorId', required: false })
  findAll(
    @Query('category') category?: string,
    @Query('isTrending') isTrending?: string,
    @Query('search') search?: string,
    @Query('authorId') authorId?: string,
  ) {
    const trendingBool =
      isTrending === 'true' ? true : isTrending === 'false' ? false : undefined;
    return this.audiobooksService.findAll({
      category,
      isTrending: trendingBool,
      search,
      authorId,
    });
  }

  @Get('categories')
  @ApiOperation({ summary: 'Lister les catégories de livres audio disponibles' })
  getCategories() {
    return this.audiobooksService.getCategories();
  }

  @Get('authors')
  @ApiOperation({ summary: 'Lister les auteurs enregistrés et créateurs de livres audio' })
  getAuthors() {
    return this.audiobooksService.getAuthors();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer un livre audio et tous ses chapitres' })
  findOne(@Param('id') id: string) {
    return this.audiobooksService.findOne(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOperation({ summary: 'Créer un nouveau livre audio' })
  create(@Body() dto: CreateAudiobookDto) {
    return this.audiobooksService.create(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  @ApiOperation({ summary: 'Modifier un livre audio' })
  update(@Param('id') id: string, @Body() dto: UpdateAudiobookDto) {
    return this.audiobooksService.update(id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer un livre audio' })
  delete(@Param('id') id: string) {
    return this.audiobooksService.delete(id);
  }

  // --- CHAPITRES ---

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/chapters')
  @ApiOperation({ summary: 'Ajouter un chapitre à un livre audio' })
  addChapter(@Param('id') audiobookId: string, @Body() dto: CreateChapterDto) {
    return this.audiobooksService.addChapter(audiobookId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put(':id/chapters/:chapterId')
  @ApiOperation({ summary: 'Modifier un chapitre d\'un livre audio' })
  updateChapter(
    @Param('id') audiobookId: string,
    @Param('chapterId') chapterId: string,
    @Body() dto: UpdateChapterDto,
  ) {
    return this.audiobooksService.updateChapter(audiobookId, chapterId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id/chapters/:chapterId')
  @ApiOperation({ summary: 'Supprimer un chapitre d\'un livre audio' })
  deleteChapter(
    @Param('id') audiobookId: string,
    @Param('chapterId') chapterId: string,
  ) {
    return this.audiobooksService.deleteChapter(audiobookId, chapterId);
  }
}
