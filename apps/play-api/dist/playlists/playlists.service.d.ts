import { PrismaService } from '../prisma/prisma.service';
export declare class PlaylistsService {
    private prisma;
    constructor(prisma: PrismaService);
    private includeRelations;
    findMine(userId: string): Promise<({
        songs: ({
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
        })[];
    } & {
        id: string;
        name: string;
        coverUrl: string | null;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    create(userId: string, name: string): Promise<{
        songs: ({
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
        })[];
    } & {
        id: string;
        name: string;
        coverUrl: string | null;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    delete(userId: string, playlistId: string): Promise<{
        success: boolean;
    }>;
    addSong(userId: string, playlistId: string, songId: string): Promise<{
        songs: ({
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
        })[];
    } & {
        id: string;
        name: string;
        coverUrl: string | null;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    removeSong(userId: string, playlistId: string, songId: string): Promise<{
        songs: ({
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
        })[];
    } & {
        id: string;
        name: string;
        coverUrl: string | null;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
