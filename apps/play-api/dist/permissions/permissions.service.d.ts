import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
export declare class PermissionsService implements OnModuleInit {
    private prisma;
    constructor(prisma: PrismaService);
    onModuleInit(): Promise<void>;
    findAll(): import("@prisma/client").Prisma.PrismaPromise<{
        id: string;
        action: string;
        resource: string;
    }[]>;
}
