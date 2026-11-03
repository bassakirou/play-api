import { MediaSourceOwnershipService } from '../content-access/media-source-ownership.service';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AcademicSubscriptionService } from '../content-access/academic-subscription.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCourseDto,
  UpdateCourseDto,
  CreateModuleDto,
  CreateLessonDto,
} from './dto/course.dto';

@Injectable()
export class AcademicService {
  private readonly subscriptions: AcademicSubscriptionService;
  constructor(private readonly prisma: PrismaService) {
    this.subscriptions = new AcademicSubscriptionService(prisma);
  }

  private validatePrice(course: {
    isMonetized?: boolean;
    price?: number;
    discountPrice?: number | null;
  }) {
    if (
      course.price !== undefined &&
      (!Number.isInteger(course.price) || course.price < 0)
    ) {
      throw new BadRequestException(
        'Le prix doit être un entier positif ou nul.',
      );
    }
    if (course.isMonetized && (!course.price || course.price <= 0)) {
      throw new BadRequestException(
        'Une formation payante doit avoir un prix positif.',
      );
    }
    if (
      course.discountPrice != null &&
      (!Number.isInteger(course.discountPrice) ||
        course.discountPrice <= 0 ||
        course.discountPrice >= (course.price || 0))
    ) {
      throw new BadRequestException(
        'La remise doit être positive et inférieure au prix.',
      );
    }
  }

  private async getAccess(
    course: { id: string; instructorId: string | null; isMonetized: boolean },
    userId?: string,
  ) {
    const isPurchased =
      !!userId &&
      !!(await this.prisma.userPurchasedContent.findUnique({
        where: {
          userId_contentId_contentType: {
            userId,
            contentId: course.id,
            contentType: 'COURSE',
          },
        },
      }));
    const isManager =
      !!userId &&
      (course.instructorId === userId ||
        (await this.subscriptions.isAdmin(userId)));
    return {
      hasAccess: !course.isMonetized || isPurchased || isManager,
      isPurchased,
      isManager,
    };
  }

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

  async findOne(id: string, userId?: string) {
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

    const access = await this.getAccess(course, userId);
    if (!course.isPublished && !access.isManager)
      throw new NotFoundException(`Formation ${id} non trouvée`);
    return {
      ...course,
      hasAccess: access.hasAccess,
      isPurchased: access.isPurchased,
      modules: course.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson) => {
          if (access.hasAccess || lesson.isFreePreview) return lesson;
          const { contentUrl, notes, resources, ...metadata } = lesson;
          return metadata;
        }),
      })),
    };
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
        certified: inst.artistProfile?.certified ?? false,
        coursesCount: inst.instructedCourses.length,
        totalStudents,
        rating: Number(avgRating.toFixed(1)),
      };
    });
  }

  async create(userId: string, dto: CreateCourseDto) {
    await this.subscriptions.assertCanPublish(userId);
    this.validatePrice(dto);

    return this.prisma.academicCourse.create({
      data: {
        isMonetized: dto.isMonetized ?? false,
        price: dto.price ?? 0,
        discountPrice: dto.discountPrice,
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
    const course = await this.prisma.academicCourse.findUnique({
      where: { id },
    });
    if (!course) {
      throw new NotFoundException(`Formation ${id} non trouvée`);
    }

    isAdmin = await this.subscriptions.isAdmin(userId);
    if (!isAdmin && course.instructorId !== userId) {
      throw new ForbiddenException(
        "Vous n'avez pas l'autorisation de modifier cette formation.",
      );
    }

    await this.subscriptions.assertCanPublish(userId);
    this.validatePrice({ ...course, ...dto });
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
    const course = await this.prisma.academicCourse.findUnique({
      where: { id },
    });
    if (!course) {
      throw new NotFoundException(`Formation ${id} non trouvée`);
    }

    isAdmin = await this.subscriptions.isAdmin(userId);
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
    if (!course)
      throw new NotFoundException(`Formation ${courseId} non trouvée`);

    isAdmin = await this.subscriptions.isAdmin(userId);
    if (!isAdmin && course.instructorId !== userId) {
      throw new ForbiddenException('Action non autorisée.');
    }

    await this.subscriptions.assertCanPublish(userId);
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

    isAdmin = await this.subscriptions.isAdmin(userId);
    if (!isAdmin && module.course.instructorId !== userId) {
      throw new ForbiddenException('Action non autorisée.');
    }

    await this.subscriptions.assertCanPublish(userId);
    const contentUrl = await new MediaSourceOwnershipService(
      this.prisma,
      this.subscriptions,
    ).resolve(dto.contentUrl, userId);
    return this.prisma.academicLesson.create({
      data: {
        moduleId,
        title: dto.title,
        description: dto.description,
        contentType: dto.contentType || 'VIDEO',
        contentUrl,
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
    if (!course)
      throw new NotFoundException(`Formation ${courseId} non trouvée`);

    const access = await this.getAccess(course, userId);
    if (!course.isPublished && !access.isManager)
      throw new NotFoundException('Formation non trouvée');
    if (!access.hasAccess)
      throw new ForbiddenException(
        'Achetez cette formation avant de vous inscrire.',
      );

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

    if (!allLessons.some((lesson) => lesson.id === lessonId))
      throw new NotFoundException('Leçon non trouvée dans cette formation.');
    const course = await this.prisma.academicCourse.findUnique({
      where: { id: courseId },
    });
    if (!course || !(await this.getAccess(course, userId)).hasAccess)
      throw new ForbiddenException('Accès à cette formation refusé.');
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
