import { PermissionsService } from './permissions.service';
export declare class PermissionsController {
    private readonly permissionsService;
    constructor(permissionsService: PermissionsService);
    findAll(): import("@prisma/client").Prisma.PrismaPromise<{
        id: string;
        action: string;
        resource: string;
    }[]>;
}
