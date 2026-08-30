import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArtistGroupsService } from './artist-groups.service';
import { CreateArtistGroupDto } from './dto/create-artist-group.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('artist-groups')
@Controller('artist-groups')
export class ArtistGroupsController {
  constructor(private readonly artistGroupsService: ArtistGroupsService) {}

  @Post()
  create(@Body() dto: CreateArtistGroupDto, @Req() req: any) {
    const user = req.user || null;
    return this.artistGroupsService.create(dto, user);
  }

  @Get()
  findAll(@Query('creatorId') creatorId?: string) {
    return this.artistGroupsService.findAll(creatorId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('invitations')
  findInvitations(@Req() req: any) {
    return this.artistGroupsService.findInvitationsForUser(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('invitations/:id/respond')
  respondInvitation(
    @Param('id') id: string,
    @Body() body: { status: 'ACCEPTED' | 'REJECTED'; studioUrl?: string },
    @Req() req: any,
  ) {
    return this.artistGroupsService.respondInvitation(
      id,
      body.status,
      req.user,
      body.studioUrl,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.artistGroupsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: CreateArtistGroupDto,
    @Req() req: any,
  ) {
    return this.artistGroupsService.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.artistGroupsService.remove(id);
  }
}
