import { prisma } from '../src/config/db';
import { seedProperties } from './seeds/properties';

async function main() {
  console.log('🌱 --- STARTING GLOBAL SEEDING ---');

  await seedProperties();

  console.log('🏁 --- GLOBAL SEEDING SUCCESSFUL ---');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
