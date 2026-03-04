import { SearchService } from './search.service';
export declare class SearchController {
    private readonly searchService;
    constructor(searchService: SearchService);
    search(q?: string): Promise<{
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
        albums: ({
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
        })[];
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
        genres: {
            id: string;
            name: string;
            createdById: string | null;
            isSystem: boolean;
            createdAt: Date;
            updatedAt: Date;
        }[];
    }>;
}
