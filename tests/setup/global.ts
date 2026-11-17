import { execFileSync } from "node:child_process";
import { TEST_DATABASE_URL } from "./env";

/** 테스트 DB에 마이그레이션을 적용한다. */
export default function setup() {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    // prisma.config.ts는 DIRECT_URL을 먼저 쓴다. .env의 DIRECT_URL(운영 DB일 수 있음)이 끼어들지 않게 비운다.
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: "" },
    stdio: "pipe",
  });
}
