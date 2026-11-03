import { AlbumsService } from './albums.service';

describe('Album catalogue', () => {
  it('does not delete empty albums while reading the public catalogue', async () => {
    const prisma: any = {
      album: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'draft', coverUrl: null }]),
        deleteMany: jest.fn(),
      },
    };
    const service = new AlbumsService(prisma, {} as any);
    await service.findAll();
    expect(prisma.album.deleteMany).not.toHaveBeenCalled();
  });
});
