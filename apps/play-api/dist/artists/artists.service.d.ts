import { PrismaService } from '../prisma/prisma.service';
import { CreateArtistDto } from './dto/create-artist.dto';
export declare class ArtistsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createArtistDto: CreateArtistDto, user: any): Promise<{
        id: string;
        name: string;
        bio: string | null;
        imageUrl: string | null;
        userId: string | null;
        labelId: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    findAll(): import("@prisma/client").Prisma.PrismaPromise<({
        albums: {
            id: string;
            title: string;
            year: number;
            coverUrl: string | null;
            description: string | null;
            artistId: string;
            createdAt: Date;
            updatedAt: Date;
        }[];
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
        name: string;
        bio: string | null;
        imageUrl: string | null;
        userId: string | null;
        labelId: string | null;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    findCreators(): import("@prisma/client").Prisma.PrismaPromise<({
        user: {
            id: string;
            email: string;
            password: string;
            name: string;
            roleId: string;
            resetToken: string | null;
            resetTokenExpiry: Date | null;
            createdAt: Date;
            updatedAt: Date;
        } | null;
    } & {
        id: string;
        name: string;
        bio: string | null;
        imageUrl: string | null;
        userId: string | null;
        labelId: string | null;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    findOne(id: string): import("@prisma/client").Prisma.Prisma__ArtistClient<({
        albums: {
            id: string;
            title: string;
            year: number;
            coverUrl: string | null;
            description: string | null;
            artistId: string;
            createdAt: Date;
            updatedAt: Date;
        }[];
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
        name: string;
        bio: string | null;
        imageUrl: string | null;
        userId: string | null;
        labelId: string | null;
        createdAt: Date;
        updatedAt: Date;
    }) | null, null, import("@prisma/client/runtime/library").DefaultArgs>;
    update(id: string, updateArtistDto: any, user: any): import("@prisma/client").Prisma.Prisma__ArtistClient<{
        id: string;
        name: string;
        bio: string | null;
        imageUrl: string | null;
        userId: string | null;
        labelId: string | null;
        createdAt: Date;
        updatedAt: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    remove(id: string): import("@prisma/client").Prisma.Prisma__ArtistClient<{
        id: string;
        name: string;
        bio: string | null;
        imageUrl: string | null;
        userId: string | null;
        labelId: string | null;
        createdAt: Date;
        updatedAt: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
}
