import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- MISE À JOUR DU RÔLE ADMIN ---');
  
  // 1. S'assurer que le rôle ADMIN existe
  let adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  if (!adminRole) {
    adminRole = await prisma.role.create({ data: { name: 'ADMIN' } });
    console.log('Rôle ADMIN créé.');
  }

  // 2. Mettre à jour l'utilisateur
  const user = await prisma.user.update({
    where: { email: 'bassahakjm@gmail.com' },
    data: {
      roleId: adminRole.id
    }
  });

  console.log(`L'utilisateur ${user.email} est maintenant ADMIN.`);
  console.log('--- FIN DE LA MISE À JOUR ---');
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
