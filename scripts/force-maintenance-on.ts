import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const state = await prisma.maintenanceState.upsert({
    where: { id: "default" },
    update: { enabled: true },
    create: { id: "default", enabled: true },
  });

  console.log(state);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
