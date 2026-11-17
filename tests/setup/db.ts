import { prisma } from "@/lib/db";

/** 모든 테이블을 비운다 (테스트 간 격리). */
export async function resetDb() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const names = rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await prisma.$executeRawUnsafe(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}

let seq = 0;
export async function createUser(name = "사용자") {
  seq += 1;
  return prisma.user.create({ data: { email: `user${Date.now()}_${seq}@example.com`, name } });
}
