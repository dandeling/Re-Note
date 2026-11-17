import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // CLI(migrate 등)용 주소. Supabase처럼 앱은 트랜잭션 풀러(DATABASE_URL, 포트 6543)로 붙고
  // 마이그레이션은 직접/세션 연결(DIRECT_URL)로 해야 하는 곳을 위해 DIRECT_URL을 먼저 쓴다.
  // 런타임 연결(lib/db.ts)은 언제나 DATABASE_URL이다.
  datasource: {
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"],
  },
});
