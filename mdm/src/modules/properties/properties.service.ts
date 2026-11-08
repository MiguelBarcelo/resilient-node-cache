import { prisma } from '../../config/db.ts';

export const listProperties = async () => {
  return prisma.property.findMany();
};
