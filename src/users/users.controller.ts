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
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CheckPermissions } from '../auth/permissions.decorator';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  getMyProfile(@Request() req) {
    return this.usersService.findOne(req.user.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('me/profile')
  @ApiOperation({ summary: 'Update current user profile' })
  updateProfile(@Request() req, @Body() updateUserDto: any) {
    const fields = ['email', 'password', 'name', 'bio', 'imageUrl', 'bannerUrl', 'country', 'gallery'];
    const profile = Object.fromEntries(fields.filter(key => updateUserDto?.[key] !== undefined).map(key => [key, updateUserDto[key]]));
    return this.usersService.update(req.user.userId, profile);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('me/system-roles')
  @ApiOperation({ summary: 'Update current user system roles' })
  updateMySystemRoles(@Request() req, @Body('systemRoles') systemRoles: string[]) {
    return this.usersService.updateSystemRoles(req.user.userId, systemRoles);
  }

  @Get('authors')
  @ApiOperation({ summary: 'Get list of users with AUTHOR system role' })
  findAuthors() {
    return this.usersService.findAuthors();
  }

  @Get('creators')
  @ApiOperation({ summary: 'Get list of users with CREATOR system role' })
  findCreators() {
    return this.usersService.findCreators();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @CheckPermissions('create:user')
  @Post()
  async create(@Request() req, @Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto, await this.usersService.canManageAdministrativeRoles(req.user.userId));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @CheckPermissions('read:user')
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  // Favorites Endpoints - must be before :id to avoid conflict
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me/favorites')
  @ApiOperation({ summary: 'Get current user favorites' })
  getMyFavorites(@Request() req) {
    return this.usersService.getFavorites(req.user.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('me/favorites/:songId')
  @ApiOperation({ summary: 'Add song to favorites' })
  addFavorite(@Request() req, @Param('songId') songId: string) {
    return this.usersService.addFavorite(req.user.userId, songId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('me/favorites/:songId')
  @ApiOperation({ summary: 'Remove song from favorites' })
  removeFavorite(@Request() req, @Param('songId') songId: string) {
    return this.usersService.removeFavorite(req.user.userId, songId);
  }

  // Follow Artists Endpoints
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me/following')
  @ApiOperation({ summary: 'Get current user followed artists' })
  getMyFollowing(@Request() req) {
    return this.usersService.getFollowing(req.user.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('me/following/:artistId')
  @ApiOperation({ summary: 'Follow an artist' })
  followArtist(@Request() req, @Param('artistId') artistId: string) {
    return this.usersService.followArtist(req.user.userId, artistId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('me/following/:artistId')
  @ApiOperation({ summary: 'Unfollow an artist' })
  unfollowArtist(@Request() req, @Param('artistId') artistId: string) {
    return this.usersService.unfollowArtist(req.user.userId, artistId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @CheckPermissions('read:user')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @CheckPermissions('update:user')
  @Patch(':id')
  async update(@Request() req, @Param('id') id: string, @Body() updateUserDto: any) {
    return this.usersService.update(id, updateUserDto, await this.usersService.canManageAdministrativeRoles(req.user.userId));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @CheckPermissions('delete:user')
  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.usersService.remove(id, req.user?.userId);
  }
}
