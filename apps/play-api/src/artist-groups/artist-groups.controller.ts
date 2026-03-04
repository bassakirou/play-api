import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArtistGroupsService } from './artist-groups.service';
import { CreateArtistGroupDto } from './dto/create-artist-group.dto';

@ApiTags('artist-groups')
@Controller('artist-groups')
export class ArtistGroupsController {
  constructor(private readonly artistGroupsService: ArtistGroupsService) {}

  @Post()
  create(@Body() dto: CreateArtistGroupDto) {
    return this.artistGroupsService.create(dto);
  }

  @Get()
  findAll() {
    return this.artistGroupsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.artistGroupsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: CreateArtistGroupDto) {
    return this.artistGroupsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.artistGroupsService.remove(id);
  }
}
