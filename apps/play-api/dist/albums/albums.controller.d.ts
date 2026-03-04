import { AlbumsService } from './albums.service';
import { CreateAlbumDto } from './dto/create-album.dto';
export declare class AlbumsController {
    private readonly albumsService;
    constructor(albumsService: AlbumsService);
    create(createAlbumDto: CreateAlbumDto): Promise<{
        id: string;
        title: string;
        year: number;
        coverUrl: string | null;
        description: string | null;
        artistId: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    findAll(): import("@prisma/client").Prisma.PrismaPromise<({
        artist: {
            id: string;
            name: string;
            bio: string | null;
            imageUrl: string | null;
            userId: string | null;
            labelId: string | null;
            createdAt: Date;
            updatedAt: Date;
        };
        songs: {
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
        }[];
    } & {
        id: string;
        title: string;
        year: number;
        coverUrl: string | null;
        description: string | null;
        artistId: string;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    findOne(id: string): import("@prisma/client").Prisma.Prisma__AlbumClient<({
        artist: {
            id: string;
            name: string;
            bio: string | null;
            imageUrl: string | null;
            userId: string | null;
            labelId: string | null;
            createdAt: Date;
            updatedAt: Date;
        };
        songs: {
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
        }[];
    } & {
        id: string;
        title: string;
        year: number;
        coverUrl: string | null;
        description: string | null;
        artistId: string;
        createdAt: Date;
        updatedAt: Date;
    }) | null, null, import("@prisma/client/runtime/library").DefaultArgs>;
    update(id: string, updateAlbumDto: any): import("@prisma/client").Prisma.Prisma__AlbumClient<{
        id: string;
        title: string;
        year: number;
        coverUrl: string | null;
        description: string | null;
        artistId: string;
        createdAt: Date;
        updatedAt: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    remove(id: string): Promise<{
        id: string;
        title: string;
        year: number;
        coverUrl: string | null;
        description: string | null;
        artistId: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
