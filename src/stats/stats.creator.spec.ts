import { StatsService } from './stats.service';
describe('Creator analytics isolation', () => {
  it('filters every source by the authenticated owner and exposes no fabricated metrics', async () => {
    const db = {
      song: { findMany: jest.fn().mockResolvedValue([{ id: 'song', title: 'Owned', plays: 4 }]) },
      video: { findMany: jest.fn().mockResolvedValue([{ id: 'video', title: 'Owned', views: 2 }]) },
      audiobook: { findMany: jest.fn().mockResolvedValue([]) },
      album: { findMany: jest.fn().mockResolvedValue([]) },
      academicCourse: { findMany: jest.fn().mockResolvedValue([]) },
      transaction: { aggregate: jest.fn().mockResolvedValue({ _sum: { creatorShare: 70 } }) },
    };
    const result = await new StatsService(db as any).getCreatorStats('owner');
    expect(db.song.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { artists: { some: { userId: 'owner' } } } }));
    expect(db.video.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'owner' } }));
    expect(db.audiobook.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { authorId: 'owner' } }));
    expect(db.album.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { artist: { userId: 'owner' } } }));
    expect(db.academicCourse.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { instructorId: 'owner' } }));
    expect(db.transaction.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'SUCCESS', beneficiaryUserId: 'owner' } }));
    expect(result).toMatchObject({ plays: 4, views: 2, creatorRevenue: 70, uniqueListeners: null, retention: null });
  });
});
