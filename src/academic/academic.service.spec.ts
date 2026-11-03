import { ForbiddenException } from '@nestjs/common';
import { AcademicService } from './academic.service';

describe('Academic publishing and learner access', () => {
  let prisma: any;
  let service: AcademicService;
  const course = () => ({
    id: 'course',
    instructorId: 'teacher',
    isPublished: true,
    isMonetized: true,
    price: 1500,
    discountPrice: null,
    modules: [
      {
        lessons: [
          {
            id: 'lesson',
            contentUrl: 'private.mp4',
            notes: 'paid text',
            resources: [{ url: 'private.pdf' }],
            isFreePreview: false,
          },
          { id: 'preview', contentUrl: 'preview.mp4', isFreePreview: true },
        ],
      },
    ],
  });
  beforeEach(() => {
    prisma = {
      mediaAsset: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ systemRoles: ['ACADEMIC'] }),
      },
      userSubscription: { findFirst: jest.fn().mockResolvedValue(null) },
      academicCourse: {
        findUnique: jest.fn().mockResolvedValue(course()),
        create: jest.fn().mockResolvedValue({ id: 'new' }),
        update: jest.fn().mockResolvedValue({}),
      },
      academicModule: {
        findUnique: jest.fn().mockResolvedValue({ course: course() }),
        create: jest.fn().mockResolvedValue({}),
      },
      academicLesson: { create: jest.fn().mockResolvedValue({}) },
      userPurchasedContent: { findUnique: jest.fn().mockResolvedValue(null) },
      courseEnrollment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'enrollment' }),
      },
    };
    service = new AcademicService(prisma);
  });
  it('rejects publishing from a permanent role without an active subscription', async () => {
    await expect(
      service.create('teacher', { title: 'Course' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('requires a current active subscription period when publishing', async () => {
    prisma.userSubscription.findFirst.mockResolvedValue({ id: 'subscription' });
    await expect(
      service.create('teacher', { title: 'Course' }),
    ).resolves.toEqual({ id: 'new' });
    expect(prisma.userSubscription.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'teacher',
        status: 'ACTIVE',
        startDate: { lte: expect.any(Date) },
        endDate: { gt: expect.any(Date) },
        plan: { code: 'ACADEMIC_MONTHLY' },
      }),
    });
  });
  it.each(['update', 'addModule', 'addLesson'])(
    'rejects %s after subscription expiration',
    async (method) => {
      const args =
        method === 'update'
          ? ['course', 'teacher', {}, false]
          : ['course', 'teacher', { title: 'New' }, false];
      await expect(
        (service[method as keyof AcademicService] as any)(...args),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it('allows a verified administrator to publish without a subscription', async () => {
    prisma.user.findUnique.mockResolvedValue({ systemRoles: ['ADMIN'] });
    await expect(service.create('admin', { title: 'Course' })).resolves.toEqual(
      { id: 'new' },
    );
  });
  it('redacts paid lesson sources, text and resources publicly while retaining preview', async () => {
    const result = await service.findOne('course');
    expect(result.modules[0].lessons[0]).not.toHaveProperty('contentUrl');
    expect(result.modules[0].lessons[0]).not.toHaveProperty('notes');
    expect(result.modules[0].lessons[0]).not.toHaveProperty('resources');
    expect(result.modules[0].lessons[1]).toHaveProperty(
      'contentUrl',
      'preview.mp4',
    );
  });
  it('rejects enrollment to a paid course without a COURSE purchase', async () => {
    await expect(service.enroll('learner', 'course')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('permits free enrollment without a trainer subscription', async () => {
    prisma.academicCourse.findUnique.mockResolvedValue({
      ...course(),
      isMonetized: false,
    });
    await expect(service.enroll('learner', 'course')).resolves.toEqual({
      id: 'enrollment',
    });
  });
  it('grants paid lessons to a purchaser without checking the instructor subscription', async () => {
    prisma.userPurchasedContent.findUnique.mockResolvedValue({
      id: 'purchase',
    });
    const result = await service.findOne('course', 'learner');
    expect(result.hasAccess).toBe(true);
    expect(result.isPurchased).toBe(true);
    expect(result.modules[0].lessons[0]).toHaveProperty('notes', 'paid text');
    await expect(service.enroll('learner', 'course')).resolves.toHaveProperty(
      'id',
      'enrollment',
    );
    expect(prisma.userSubscription.findFirst).not.toHaveBeenCalled();
  });
  it('does not trust an existing enrollment as proof of a paid purchase', async () => {
    prisma.courseEnrollment.findUnique.mockResolvedValue({
      id: 'legacy-enrollment',
    });
    await expect(service.enroll('learner', 'course')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('lets an owner inspect paid lessons after their publishing subscription expires', async () => {
    const result = await service.findOne('course', 'teacher');
    expect(result.modules[0].lessons[0]).toHaveProperty(
      'contentUrl',
      'private.mp4',
    );
  });
  it('does not reveal an unpublished course to a learner who has not purchased it', async () => {
    prisma.academicCourse.findUnique.mockResolvedValue({
      ...course(),
      isPublished: false,
    });
    await expect(service.findOne('course')).rejects.toThrow('non trouvée');
  });
  it.each([
    { price: -1 },
    { price: 1.5 },
    { isMonetized: true, price: 0 },
    { price: 500, discountPrice: 500 },
    { price: 500, discountPrice: -1 },
  ])('rejects invalid course pricing %j', async (pricing) => {
    prisma.userSubscription.findFirst.mockResolvedValue({ id: 'subscription' });
    await expect(
      service.create('teacher', { title: 'Course', ...pricing }),
    ).rejects.toThrow();
  });

  it.each([
    {
      status: 'CANCELLED',
      startDate: new Date('2020-01-01'),
      endDate: new Date('2099-01-01'),
    },
    {
      status: 'ACTIVE',
      startDate: new Date('2020-01-01'),
      endDate: new Date('2021-01-01'),
    },
    {
      status: 'ACTIVE',
      startDate: new Date('2098-01-01'),
      endDate: new Date('2099-01-01'),
    },
  ])(
    'denies publishing with a cancelled, expired or future subscription %j',
    async (subscription) => {
      prisma.userSubscription.findFirst.mockImplementation(
        async ({ where }: any) =>
          subscription.status === where.status &&
          subscription.startDate <= where.startDate.lte &&
          subscription.endDate > where.endDate.gt
            ? subscription
            : null,
      );
      await expect(
        service.create('teacher', { title: 'Course' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it('does not trust a caller supplied admin flag for ownership', async () => {
    await expect(
      service.update('course', 'stranger', {}, true),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects a lesson source copied from another creators private storage', async () => {
    prisma.userSubscription.findFirst.mockResolvedValue({ id: 'subscription' });
    await expect(
      service.addLesson(
        'module',
        'teacher',
        {
          title: 'Lesson',
          contentUrl: 'https://media.pyramidplay.cm/video/victim.mp4',
        },
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
