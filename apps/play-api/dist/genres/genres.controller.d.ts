import { GenresService } from './genres.service';
import { CreateGenreDto } from './dto/create-genre.dto';
export declare class GenresController {
    private readonly genresService;
    constructor(genresService: GenresService);
    create(createGenreDto: CreateGenreDto, req: any): Promise<{
        id: string;
        name: string;
        createdById: string | null;
        isSystem: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
    findAll(): import("@prisma/client").Prisma.PrismaPromise<{
        id: string;
        name: string;
        createdById: string | null;
        isSystem: boolean;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    findOne(id: string): import("@prisma/client").Prisma.Prisma__GenreClient<{
        id: string;
        name: string;
        createdById: string | null;
        isSystem: boolean;
        createdAt: Date;
        updatedAt: Date;
    } | null, null, import("@prisma/client/runtime/library").DefaultArgs>;
    update(id: string, updateGenreDto: any, req: any): Promise<{
        id: string;
        name: string;
        createdById: string | null;
        isSystem: boolean;
        createdAt: Date;
        updatedAt: Date;
    } | null>;
    remove(id: string, req: any): Promise<{
        id: string;
        name: string;
        createdById: string | null;
        isSystem: boolean;
        createdAt: Date;
        updatedAt: Date;
    } | null>;
}
