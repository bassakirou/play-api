import { PlaylistsService } from './playlists.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
export declare class PlaylistsController {
    private playlistsService;
    constructor(playlistsService: PlaylistsService);
    getMine(req: {
        user: {
            userId: string;
        };
    }): Promise<({
        songs: ({
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
        })[];
    } & {
        id: string;
        name: string;
        coverUrl: string | null;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    create(req: {
        user: {
            userId: string;
        };
    }, dto: CreatePlaylistDto): Promise<{
        songs: ({
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
        })[];
    } & {
        id: string;
        name: string;
        coverUrl: string | null;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    delete(req: {
        user: {
            userId: string;
        };
    }, id: string): Promise<{
        success: boolean;
    }>;
    addSong(req: {
        user: {
            userId: string;
        };
    }, id: string, songId: string): Promise<{
        songs: ({
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
        })[];
    } & {
        id: string;
        name: string;
        coverUrl: string | null;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    removeSong(req: {
        user: {
            userId: string;
        };
    }, id: string, songId: string): Promise<{
        songs: ({
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
