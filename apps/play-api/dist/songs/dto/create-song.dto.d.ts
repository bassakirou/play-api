export declare class CreateSongDto {
    title: string;
    duration: number;
    coverUrl?: string;
    isSingle: boolean;
    audioUrl: string;
    artistIds: string[];
    groupIds?: string[];
    albumId?: string;
    genreId: string;
}
