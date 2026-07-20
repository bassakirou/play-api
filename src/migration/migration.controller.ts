import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { MigrationService } from './migration.service';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('migration')
@Controller('migration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class MigrationController {
  constructor(private readonly migrationService: MigrationService) {}

  @Get('export')
  @ApiOperation({ summary: 'Export all database records' })
  exportData() {
    return this.migrationService.exportData();
  }

  @Post('import')
  @ApiOperation({ summary: 'Import data and migrate media to MinIO' })
  importData(@Body() data: any) {
    return this.migrationService.importData(data);
  }
}
