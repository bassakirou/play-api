import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGenreDto } from './dto/create-genre.dto';
export declare class GenresService implements OnModuleInit {
    private prisma;
    constructor(prisma: PrismaService);
    onModuleInit(): Promise<void>;
    create(createGenreDto: CreateGenreDto, user: any): Promise<{
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
    update(id: string, updateGenreDto: any, user: any): Promise<{
        id: string;
        name: string;
        createdById: string | null;
        isSystem: boolean;
        createdAt: Date;
        updatedAt: Date;
    } | null>;
    remove(id: string, user: any): Promise<{
        id: string;
        name: string;
        createdById: string | null;
        isSystem: boolean;
        createdAt: Date;
        updatedAt: Date;
    } | null>;
}
