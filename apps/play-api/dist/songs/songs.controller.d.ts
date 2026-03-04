import { SongsService } from './songs.service';
import { CreateSongDto } from './dto/create-song.dto';
export declare class SongsController {
    private readonly songsService;
    constructor(songsService: SongsService);
    create(createSongDto: CreateSongDto): import("@prisma/client").Prisma.Prisma__SongClient<{
        id: string;
        title: string;
        duration: number;
        coverUrl: string | null;
        isSingle: boolean;
        audioUrl: string;
        albumId: string | null;
        genreId: string;
        createdAt: Date;
        updatedAt: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    findAll(): import("@prisma/client").Prisma.PrismaPromise<({
        artists: {
            id: string;
            name: string;
            bio: string | null;
            imageUrl: string | null;
            userId: string | null;
            labelId: string | null;
            createdAt: Date;
            updatedAt: Date;
        }[];
        groups: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
        }[];
        album: {
            id: string;
            title: string;
            year: number;
            coverUrl: string | null;
            description: string | null;
            artistId: string;
            createdAt: Date;
            updatedAt: Date;
        } | null;
        genre: {
            id: string;
            name: string;
            createdById: string | null;
            isSystem: boolean;
            createdAt: Date;
            updatedAt: Date;
        };
    } & {
        id: string;
        title: string;
        duration: number;
        coverUrl: string | null;
        isSingle: boolean;
        audioUrl: string;
        albumId: string | null;
        genreId: string;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    findOne(id: string): import("@prisma/client").Prisma.Prisma__SongClient<({
        artists: {
            id: string;
            name: string;
            bio: string | null;
            imageUrl: string | null;
            userId: string | null;
            labelId: string | null;
            createdAt: Date;
            updatedAt: Date;
        }[];
        groups: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
        }[];
        album: {
            id: string;
            title: string;
            year: number;
            coverUrl: string | null;
            description: string | null;
            artistId: string;
            createdAt: Date;
            updatedAt: Date;
        } | null;
        genre: {
            id: string;
            name: string;
            createdById: string | null;
            isSystem: boolean;
            createdAt: Date;
            updatedAt: Date;
        };
    } & {
        id: string;
        title: string;
        duration: number;
        coverUrl: string | null;
        isSingle: boolean;
        audioUrl: string;
        albumId: string | null;
        genreId: string;
        createdAt: Date;
        updatedAt: Date;
    }) | null, null, import("@prisma/client/runtime/library").DefaultArgs>;
    update(id: string, updateSongDto: any): import("@prisma/client").Prisma.Prisma__SongClient<{
        id: string;
        title: string;
        duration: number;
        coverUrl: string | null;
        isSingle: boolean;
        audioUrl: string;
        albumId: string | null;
        genreId: string;
        createdAt: Date;
        updatedAt: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    remove(id: string): Promise<{
        ok: boolean;
        albumDeleted: {
            id: string;
            title: string;
            year: number;
            coverUrl: string | null;
            description: string | null;
            artistId: string;
            createdAt: Date;
            updatedAt: Date;
        } | null;
    }>;
}
