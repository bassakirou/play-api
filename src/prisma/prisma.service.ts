import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    // Dans un environnement Serverless (Vercel), on évite de forcer la connexion au démarrage
    // pour réduire le temps de bootstrap et éviter les timeouts FUNCTION_INVOCATION_FAILED.
    // Prisma se connectera automatiquement lors de la première requête.
    // await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
