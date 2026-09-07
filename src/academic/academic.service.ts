import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCourseDto,
  UpdateCourseDto,
  CreateModuleDto,
  CreateLessonDto,
} from './dto/course.dto';

@Injectable()
export class AcademicService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: {
    category?: string;
    level?: string;
    search?: string;
    instructorId?: string;
  }) {
    const { category, level, search, instructorId } = params;
    const where: any = { isPublished: true };

    if (category && category !== 'all' && category !== 'Tous') {
      where.category = { equals: category, mode: 'insensitive' };
    }

    if (level && level !== 'all') {
      where.level = level;
    }

    if (instructorId) {
      where.instructorId = instructorId;
    }

    if (search && search.trim()) {
      where.OR = [
        { title: { contains: search.trim(), mode: 'insensitive' } },
        { subtitle: { contains: search.trim(), mode: 'insensitive' } },
        { description: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    return this.prisma.academicCourse.findMany({
      where,
      include: {
        instructor: {
          select: {
            id: true,
            name: true,
            email: true,
            artistProfile: {
              select: {
                imageUrl: true,
                bio: true,
              },
            },
          },
        },
        modules: {
          include: {
            lessons: {
              select: {
                id: true,
                title: true,
                durationSeconds: true,
                isFreePreview: true,
                contentType: true,
                order: true,
              },
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string) {
    const course = await this.prisma.academicCourse.findUnique({
      where: { id },
      include: {
        instructor: {
          select: {
            id: true,
            name: true,
            email: true,
            artistProfile: {
              select: {
                imageUrl: true,
                bio: true,
              },
            },
          },
        },
        modules: {
          include: {
            lessons: {
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!course) {
      throw new NotFoundException(`Formation ${id} non trouvée`);
    }

    return course;
  }

  async getCategories() {
    const courses = await this.prisma.academicCourse.findMany({
      where: { isPublished: true },
      select: { category: true },
    });

    const counts: Record<string, number> = {};
    for (const c of courses) {
      const cat = c.category || 'Général';
      counts[cat] = (counts[cat] || 0) + 1;
    }

    return Object.entries(counts).map(([name, count]) => ({
      name,
      count,
    }));
  }

  async getInstructors() {
    const instructors = await this.prisma.user.findMany({
      where: {
        OR: [
          { systemRoles: { has: 'ACADEMIC' } },
          { instructedCourses: { some: {} } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        artistProfile: {
          select: {
            imageUrl: true,
            bio: true,
            certified: true,
          },
        },
        instructedCourses: {
          where: { isPublished: true },
          select: {
            id: true,
            title: true,
            studentsCount: true,
            rating: true,
          },
        },
      },
    });

    return instructors.map((inst) => {
      const totalStudents = inst.instructedCourses.reduce(
        (sum, c) => sum + c.studentsCount,
        0,
      );
      const avgRating = inst.instructedCourses.length
        ? inst.instructedCourses.reduce((sum, c) => sum + c.rating, 0) /
          inst.instructedCourses.length
        : 5.0;

      return {
        id: inst.id,
        name: inst.name,
        email: inst.email,
        imageUrl: inst.artistProfile?.imageUrl || null,
        bio: inst.artistProfile?.bio || null,
        certified: inst.artistProfile?.certified || true,
        coursesCount: inst.instructedCourses.length,
        totalStudents,
        rating: Number(avgRating.toFixed(1)),
      };
    });
  }

  async create(userId: string, dto: CreateCourseDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { systemRoles: true, role: { select: { name: true } } },
    });

    const isAuthorized =
      user?.systemRoles?.includes('ACADEMIC') ||
      user?.systemRoles?.includes('ADMIN') ||
      user?.systemRoles?.includes('SUPER_ADMIN') ||
      user?.role?.name === 'ADMIN' ||
      user?.role?.name === 'SUPER_ADMIN';

    if (!isAuthorized) {
      throw new ForbiddenException(
        "Vous devez posséder le rôle ACADEMIC pour créer une formation.",
      );
    }

    return this.prisma.academicCourse.create({
      data: {
        title: dto.title,
        subtitle: dto.subtitle,
        description: dto.description,
        thumbnailUrl: dto.thumbnailUrl,
        previewVideoUrl: dto.previewVideoUrl,
        category: dto.category || 'Tech & Code',
        level: dto.level || 'ALL_LEVELS',
        language: dto.language || 'Français',
        durationHours: dto.durationHours || 0,
        learningOutcomes: dto.learningOutcomes || [],
        requirements: dto.requirements || [],
        instructorId: userId,
        instructorBio: dto.instructorBio,
        instructorTitle: dto.instructorTitle,
      },
      include: {
        instructor: { select: { id: true, name: true } },
        modules: true,
      },
    });
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateCourseDto,
    isAdmin: boolean,
  ) {
    const course = await this.prisma.academicCourse.findUnique({ where: { id } });
    if (!course) {
      throw new NotFoundException(`Formation ${id} non trouvée`);
    }

    if (!isAdmin && course.instructorId !== userId) {
      throw new ForbiddenException(
        "Vous n'avez pas l'autorisation de modifier cette formation.",
      );
    }

    return this.prisma.academicCourse.update({
      where: { id },
      data: dto,
      include: {
        modules: {
          include: { lessons: true },
        },
      },
    });
  }

  async delete(id: string, userId: string, isAdmin: boolean) {
    const course = await this.prisma.academicCourse.findUnique({ where: { id } });
    if (!course) {
      throw new NotFoundException(`Formation ${id} non trouvée`);
    }

    if (!isAdmin && course.instructorId !== userId) {
      throw new ForbiddenException(
        "Vous n'avez pas l'autorisation de supprimer cette formation.",
      );
    }

    return this.prisma.academicCourse.delete({ where: { id } });
  }

  async addModule(
    courseId: string,
    userId: string,
    dto: CreateModuleDto,
    isAdmin: boolean,
  ) {
    const course = await this.prisma.academicCourse.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException(`Formation ${courseId} non trouvée`);

    if (!isAdmin && course.instructorId !== userId) {
      throw new ForbiddenException("Action non autorisée.");
    }

    return this.prisma.academicModule.create({
      data: {
        courseId,
        title: dto.title,
        order: dto.order ?? 0,
      },
      include: { lessons: true },
    });
  }

  async addLesson(
    moduleId: string,
    userId: string,
    dto: CreateLessonDto,
    isAdmin: boolean,
  ) {
    const module = await this.prisma.academicModule.findUnique({
      where: { id: moduleId },
      include: { course: true },
    });
    if (!module) throw new NotFoundException(`Module ${moduleId} non trouvé`);

    if (!isAdmin && module.course.instructorId !== userId) {
      throw new ForbiddenException("Action non autorisée.");
    }

    return this.prisma.academicLesson.create({
      data: {
        moduleId,
        title: dto.title,
        description: dto.description,
        contentType: dto.contentType || 'VIDEO',
        contentUrl: dto.contentUrl,
        durationSeconds: dto.durationSeconds || 0,
        order: dto.order ?? 0,
        isFreePreview: dto.isFreePreview ?? false,
        resources: dto.resources,
        notes: dto.notes,
      },
    });
  }

  async enroll(userId: string, courseId: string) {
    const course = await this.prisma.academicCourse.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException(`Formation ${courseId} non trouvée`);

    const existing = await this.prisma.courseEnrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId },
      },
    });

    if (existing) {
      return existing;
    }

    const enrollment = await this.prisma.courseEnrollment.create({
      data: {
        userId,
        courseId,
        progressPercent: 0,
        completedLessons: [],
      },
    });

    await this.prisma.academicCourse.update({
      where: { id: courseId },
      data: { studentsCount: { increment: 1 } },
    });

    return enrollment;
  }

  async getUserEnrollments(userId: string) {
    return this.prisma.courseEnrollment.findMany({
      where: { userId },
      include: {
        course: {
          include: {
            instructor: { select: { id: true, name: true } },
            modules: {
              include: {
                lessons: {
                  select: { id: true, title: true, durationSeconds: true },
                },
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async updateLessonProgress(
    userId: string,
    courseId: string,
    lessonId: string,
    completed: boolean,
  ) {
    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId },
      },
    });

    if (!enrollment) {
      throw new NotFoundException(
        "Vous n'êtes pas encore inscrit à cette formation.",
      );
    }

    // Calculer toutes les leçons du cours pour le %
    const allLessons = await this.prisma.academicLesson.findMany({
      where: {
        module: { courseId },
      },
      select: { id: true },
    });

    let completedList = [...enrollment.completedLessons];
    if (completed) {
      if (!completedList.includes(lessonId)) {
        completedList.push(lessonId);
      }
    } else {
      completedList = completedList.filter((id) => id !== lessonId);
    }

    const totalCount = allLessons.length || 1;
    const progressPercent = Math.min(
      100,
      Math.round((completedList.length / totalCount) * 100),
    );
    const isCompleted = progressPercent === 100;

    return this.prisma.courseEnrollment.update({
      where: {
        userId_courseId: { userId, courseId },
      },
      data: {
        completedLessons: completedList,
        currentLessonId: lessonId,
        progressPercent,
        isCompleted,
        completedAt: isCompleted ? new Date() : null,
      },
    });
  }
}
