import { MediaController } from './media.controller';
import { ForbiddenException } from '@nestjs/common';

describe('Manual media registration', () => {
  it('rejects registering an arbitrary internal URL before creating an owned library row', async () => {
    const media: any = { create: jest.fn() };
    const sources: any = {
      isAdmin: async () => false,
      resolve: async () => {
        throw new ForbiddenException();
      },
    };
    const controller = new MediaController(media, sources);
    await expect(
      controller.create(
        {
          title: 'Copy',
          filename: 'copy.mp3',
          fileUrl: '/uploads/victim.mp3',
          type: 'audio',
        },
        { user: { id: 'attacker', role: 'ADMIN' } },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(media.create).not.toHaveBeenCalled();
  });
  it('does not trust a stale admin claim when choosing the new record owner', async () => {
    const media: any = {
      create: jest
        .fn()
        .mockImplementation(async (data: any, userId: string) => ({
          ...data,
          userId,
        })),
    };
    const sources: any = {
      isAdmin: async () => false,
      resolve: async () => '/uploads/owned.mp3',
    };
    const controller = new MediaController(media, sources);
    const result = await controller.create(
      {
        title: 'Own',
        filename: 'own.mp3',
        fileUrl: 'pyramidplay:asset:owned',
        type: 'audio',
        userId: 'victim',
      },
      { user: { id: 'attacker', role: 'ADMIN' } },
    );
    expect(result.userId).toBe('attacker');
    expect(result.fileUrl).toBe('/uploads/owned.mp3');
  });
});
