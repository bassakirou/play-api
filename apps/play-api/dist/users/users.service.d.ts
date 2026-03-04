import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
export declare class UsersService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createUserDto: CreateUserDto): Promise<{
        id: string;
        email: string;
        password: string;
        name: string;
        roleId: string;
        resetToken: string | null;
        resetTokenExpiry: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    findAll(): Prisma.PrismaPromise<({
        role: {
            id: string;
            name: string;
        };
        artistProfile: {
            id: string;
            name: string;
            bio: string | null;
            imageUrl: string | null;
            userId: string | null;
            labelId: string | null;
            createdAt: Date;
            updatedAt: Date;
        } | null;
    } & {
        id: string;
        email: string;
        password: string;
        name: string;
        roleId: string;
        resetToken: string | null;
        resetTokenExpiry: Date | null;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    findOne(id: string): Prisma.Prisma__UserClient<({
        role: {
            id: string;
            name: string;
        };
        artistProfile: {
            id: string;
            name: string;
            bio: string | null;
            imageUrl: string | null;
            userId: string | null;
            labelId: string | null;
            createdAt: Date;
            updatedAt: Date;
        } | null;
        favorites: {
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
        email: string;
        password: string;
        name: string;
        roleId: string;
        resetToken: string | null;
        resetTokenExpiry: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }) | null, null, import("@prisma/client/runtime/library").DefaultArgs>;
    findByEmail(email: string): Prisma.Prisma__UserClient<({
        role: {
            id: string;
            name: string;
        };
    } & {
        id: string;
        email: string;
        password: string;
        name: string;
        roleId: string;
        resetToken: string | null;
        resetTokenExpiry: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }) | null, null, import("@prisma/client/runtime/library").DefaultArgs>;
    findByResetToken(token: string): Prisma.Prisma__UserClient<{
        id: string;
        email: string;
        password: string;
        name: string;
        roleId: string;
        resetToken: string | null;
        resetTokenExpiry: Date | null;
        createdAt: Date;
        updatedAt: Date;
    } | null, null, import("@prisma/client/runtime/library").DefaultArgs>;
    update(id: string, updateUserDto: any): Prisma.Prisma__UserClient<{
        id: string;
        email: string;
        password: string;
        name: string;
        roleId: string;
        resetToken: string | null;
        resetTokenExpiry: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    remove(id: string): Prisma.Prisma__UserClient<{
        id: string;
        email: string;
        password: string;
        name: string;
        roleId: string;
        resetToken: string | null;
        resetTokenExpiry: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    addFavorite(userId: string, songId: string): Promise<{
        favorites: {
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
        email: string;
        password: string;
        name: string;
        roleId: string;
        resetToken: string | null;
        resetTokenExpiry: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    removeFavorite(userId: string, songId: string): Promise<{
        favorites: {
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
        email: string;
        password: string;
        name: string;
        roleId: string;
        resetToken: string | null;
        resetTokenExpiry: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    getFavorites(userId: string): Promise<({
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
}
