import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ArtistsService } from './artists.service';
import { CreateArtistDto } from './dto/create-artist.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CheckPermissions } from '../auth/permissions.decorator';

@ApiTags('artists')
@Controller('artists')
export class ArtistsController {
  constructor(private readonly artistsService: ArtistsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  findMyChannel(@Request() req) {
    return this.artistsService.findMyChannel(req.user.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('me')
  upsertMyChannel(@Body() dto: CreateArtistDto, @Request() req) {
    return this.artistsService.upsertMyChannel(req.user.userId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMyChannel(@Body() dto: any, @Request() req) {
    return this.artistsService.updateMyChannel(req.user.userId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @CheckPermissions('create:artist')
  @Post()
  create(@Body() createArtistDto: CreateArtistDto, @Request() req) {
    return this.artistsService.create(createArtistDto, req.user);
  }

  @Get()
  findAll() {
    return this.artistsService.findAll();
  }

  @Get('creators')
  findCreators() {
    return this.artistsService.findCreators();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.artistsService.findOne(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/follow')
  follow(@Param('id') id: string, @Request() req) {
    return this.artistsService.follow(id, req.user.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/unfollow')
  unfollow(@Param('id') id: string, @Request() req) {
    return this.artistsService.unfollow(id, req.user.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/is-following')
  async isFollowing(@Param('id') id: string, @Request() req) {
    const isFollowing = await this.artistsService.isFollowing(id, req.user.userId);
    return { isFollowing };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @CheckPermissions('update:artist')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateArtistDto: any,
    @Request() req,
  ) {
    return this.artistsService.update(id, updateArtistDto, req.user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @CheckPermissions('delete:artist')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.artistsService.remove(id);
  }
}
