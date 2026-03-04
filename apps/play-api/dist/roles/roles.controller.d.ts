import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
export declare class RolesController {
    private readonly rolesService;
    constructor(rolesService: RolesService);
    create(createRoleDto: CreateRoleDto): import("@prisma/client").Prisma.Prisma__RoleClient<{
        id: string;
        name: string;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    findAll(): import("@prisma/client").Prisma.PrismaPromise<({
        permissions: {
            id: string;
            action: string;
            resource: string;
        }[];
    } & {
        id: string;
        name: string;
    })[]>;
    findOne(id: string): import("@prisma/client").Prisma.Prisma__RoleClient<({
        permissions: {
            id: string;
            action: string;
            resource: string;
        }[];
    } & {
        id: string;
        name: string;
    }) | null, null, import("@prisma/client/runtime/library").DefaultArgs>;
    update(id: string, updateRoleDto: any): import("@prisma/client").Prisma.Prisma__RoleClient<{
        id: string;
        name: string;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    remove(id: string): import("@prisma/client").Prisma.Prisma__RoleClient<{
        id: string;
        name: string;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
}
