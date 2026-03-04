import { ArtistGroupsService } from './artist-groups.service';
import { CreateArtistGroupDto } from './dto/create-artist-group.dto';
export declare class ArtistGroupsController {
    private readonly artistGroupsService;
    constructor(artistGroupsService: ArtistGroupsService);
    create(dto: CreateArtistGroupDto): import("@prisma/client").Prisma.Prisma__ArtistGroupClient<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    findAll(): import("@prisma/client").Prisma.PrismaPromise<({
        members: {
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
        name: string;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    findOne(id: string): import("@prisma/client").Prisma.Prisma__ArtistGroupClient<({
        members: {
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
        name: string;
        createdAt: Date;
        updatedAt: Date;
    }) | null, null, import("@prisma/client/runtime/library").DefaultArgs>;
    update(id: string, dto: CreateArtistGroupDto): import("@prisma/client").Prisma.Prisma__ArtistGroupClient<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    remove(id: string): import("@prisma/client").Prisma.Prisma__ArtistGroupClient<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
}
