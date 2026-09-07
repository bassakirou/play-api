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
} from '@nestjs/common';
import { AcademicService } from './academic.service';
import {
  CreateCourseDto,
  UpdateCourseDto,
  CreateModuleDto,
  CreateLessonDto,
  UpdateProgressDto,
} from './dto/course.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('academic')
export class AcademicController {
  constructor(private readonly academicService: AcademicService) {}

  @Get('courses')
  findAll(
    @Query('category') category?: string,
    @Query('level') level?: string,
    @Query('search') search?: string,
    @Query('instructorId') instructorId?: string,
  ) {
    return this.academicService.findAll({ category, level, search, instructorId });
  }

  @Get('categories')
  getCategories() {
    return this.academicService.getCategories();
  }

  @Get('instructors')
  getInstructors() {
    return this.academicService.getInstructors();
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-learning')
  getMyLearning(@Request() req: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.academicService.getUserEnrollments(userId);
  }

  @Get('courses/:id')
  findOne(@Param('id') id: string) {
    return this.academicService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('courses')
  createCourse(@Request() req: any, @Body() dto: CreateCourseDto) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.academicService.create(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('courses/:id')
  updateCourse(
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: UpdateCourseDto,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const isAdmin =
      req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
    return this.academicService.update(id, userId, dto, isAdmin);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('courses/:id')
  deleteCourse(@Param('id') id: string, @Request() req: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const isAdmin =
      req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
    return this.academicService.delete(id, userId, isAdmin);
  }

  @UseGuards(JwtAuthGuard)
  @Post('courses/:id/enroll')
  enroll(@Param('id') id: string, @Request() req: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.academicService.enroll(userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('courses/:id/modules')
  addModule(
    @Param('id') courseId: string,
    @Request() req: any,
    @Body() dto: CreateModuleDto,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const isAdmin =
      req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
    return this.academicService.addModule(courseId, userId, dto, isAdmin);
  }

  @UseGuards(JwtAuthGuard)
  @Post('modules/:id/lessons')
  addLesson(
    @Param('id') moduleId: string,
    @Request() req: any,
    @Body() dto: CreateLessonDto,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const isAdmin =
      req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
    return this.academicService.addLesson(moduleId, userId, dto, isAdmin);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('courses/:id/progress')
  updateProgress(
    @Param('id') courseId: string,
    @Request() req: any,
    @Body() dto: UpdateProgressDto,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.academicService.updateLessonProgress(
      userId,
      courseId,
      dto.lessonId,
      dto.completed ?? true,
    );
  }
}
