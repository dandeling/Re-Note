import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * 인스턴스(프로세스)당 연결 풀 크기. DATABASE_POOL_MAX로 바꿀 수 있다.
 * 서버리스(Vercel)는 인스턴스가 여러 개 뜨므로 작게 잡는다. Supabase에서는 DATABASE_URL을 트랜잭션 풀러
 * (Supavisor, 포트 6543)로 두므로 실제 DB 연결 수는 풀러가 관리한다. 대화형 트랜잭션($transaction(async ...))이
 * 연결 하나를 붙잡은 채 다른 쿼리를 기다릴 수 있어 1로는 두지 않는다.
 * (URL의 `connection_limit`·`pgbouncer` 파라미터는 Prisma 엔진용이라 이 드라이버 어댑터에서는 무시된다.)
 */
function poolMax(): number {
  const n = Number(process.env.DATABASE_POOL_MAX);
  if (Number.isInteger(n) && n > 0) return n;
  return process.env.VERCEL ? 5 : 10;
}

function createClient() {
  // 트랜잭션 풀러와 함께 써도 안전하다: 어댑터는 이름 없는 prepared statement만 쓰고(statementNameGenerator 미지정),
  // 세션 단위 설정은 쓰지 않는다(검색의 set_config(..., true)는 트랜잭션 안에서만 유효).
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: poolMax(),
    // 서버리스에서 얼어 있던 인스턴스가 끊긴 연결을 오래 붙잡지 않게 빨리 놓는다.
    idleTimeoutMillis: process.env.VERCEL ? 10_000 : 30_000,
    connectionTimeoutMillis: 15_000,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
