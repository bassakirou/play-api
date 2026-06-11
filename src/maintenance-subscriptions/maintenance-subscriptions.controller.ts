import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateMaintenanceSubscriptionDto } from './dto/create-maintenance-subscription.dto';
import { MaintenanceSubscriptionsService } from './maintenance-subscriptions.service';
import { UpdateMaintenanceStateDto } from './dto/update-maintenance-state.dto';

@ApiTags('maintenance-subscriptions')
@Controller('maintenance-subscriptions')
export class MaintenanceSubscriptionsController {
  constructor(
    private readonly maintenanceSubscriptionsService: MaintenanceSubscriptionsService,
  ) {}

  @Post()
  create(@Body() createDto: CreateMaintenanceSubscriptionDto) {
    return this.maintenanceSubscriptionsService.create(createDto);
  }

  @Get('state')
  getState() {
    return this.maintenanceSubscriptionsService.getState();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.maintenanceSubscriptionsService.findAll();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('notify')
  notifyAll() {
    return this.maintenanceSubscriptionsService.notifyAll();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('state')
  updateState(@Body() updateDto: UpdateMaintenanceStateDto) {
    return this.maintenanceSubscriptionsService.updateState(updateDto);
  }
}
