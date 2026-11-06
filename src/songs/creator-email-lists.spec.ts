import { SongsService } from './songs.service';
import { AlbumsService } from '../albums/albums.service';

describe('Administrative creator emails', () => {
  function fixture() {
    const prisma: any = {
      song: { findMany: jest.fn(async () => [{
        id: 'single', audioUrl: 'audio.mp3', coverUrl: null,
        artists: [
          { user: { email: 'creator@example.com' } },
          { user: { email: 'creator@example.com' } },
          { user: { email: 'other@example.com' } },
          { user: null },
        ],
      }]) },
      album: { findMany: jest.fn(async () => [{ id: 'album', coverUrl: null, artist: null }]) },
    };
    const minio: any = { refreshUrl: (url: string) => url };
    return { prisma, songs: new SongsService(prisma, minio), albums: new AlbumsService(prisma, minio) };
  }

  it('shows all linked creator accounts once for a collaborative single', async () => {
    const f = fixture();
    const [song] = await f.songs.findAll(undefined, { id: 'admin', role: 'ADMIN' });
    expect(song.creatorEmails).toEqual(['creator@example.com', 'other@example.com']);
    expect(f.prisma.song.findMany.mock.calls[0][0].include.artists.include.user.select).toEqual({ email: true });
  });

  it('keeps ownership unknown for an album without a linked account', async () => {
    const f = fixture();
    const [album] = await f.albums.findAll(undefined, { id: 'admin', role: 'ADMIN' });
    expect(album.creatorEmails).toEqual([]);
  });

  it('does not select account emails in the public music catalogues', async () => {
    const f = fixture();
    await f.songs.findAll();
    await f.albums.findAll();
    expect(f.prisma.song.findMany.mock.calls[0][0].include.artists).toBe(true);
    expect(f.prisma.album.findMany.mock.calls[0][0].include.artist).toBe(true);
  });

  it('limits a non-administrator to their linked content', async () => {
    const f = fixture();
    const caller = { id: 'owner', role: 'ARTIST' };
    await f.songs.findAll(undefined, caller);
    await f.albums.findAll(undefined, caller);
    expect(f.prisma.song.findMany.mock.calls[0][0].where).toEqual({ artists: { some: { userId: 'owner' } } });
    expect(f.prisma.album.findMany.mock.calls[0][0].where).toEqual({ artist: { userId: 'owner' } });
  });
});
