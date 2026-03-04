import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(query: string) {
    const term = query.trim();
    if (!term) {
      return { songs: [], albums: [], artists: [], genres: [] };
    }

    const contains = { contains: term };

    const [songs, albums, artists, genres] = await Promise.all([
      this.prisma.song.findMany({
        where: {
          OR: [
            { title: contains },
            { album: { title: contains } },
            { artists: { some: { name: contains } } },
            { genre: { name: contains } },
          ],
        },
        include: { artists: true, album: true, genre: true },
        take: 50,
      }),
      this.prisma.album.findMany({
        where: {
          OR: [{ title: contains }, { artist: { name: contains } }],
        },
        include: { artist: true, songs: true },
        take: 50,
      }),
      this.prisma.artist.findMany({
        where: { name: contains },
        take: 50,
      }),
      this.prisma.genre.findMany({
        where: { name: contains },
        take: 50,
      }),
    ]);

    return { songs, albums, artists, genres };
  }
}
