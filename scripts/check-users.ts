import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: {
      role: true,
    },
  });
  console.log('--- LISTE DES UTILISATEURS EN BASE ---');
  console.log(
    JSON.stringify(
      users.map((u) => ({
        email: u.email,
        name: u.name,
        role: u.role?.name || 'Pas de rôle',
      })),
      null,
      2,
    ),
  );
  console.log('--- FIN DE LISTE ---');
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
