import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3100);
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL || "postgresql://researchmate:researchmate@localhost:5432/researchmate_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "ko-KR", trace: "off" },
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      AUTH_TEST_MODE: "1",
      // 실제 AI를 부르지 않는 결정적 가짜 AI (lib/ai/fake.ts)
      AI_FAKE: "1",
      // 모든 테스트가 같은 IP(localhost)에서 여러 계정으로 로그인하므로 IP당 로그인 한도를 넉넉히 둔다.
      RATE_LIMIT_AUTH_PER_10_MIN: "100000",
      AUTH_SECRET: process.env.AUTH_SECRET || "e2e-only-secret-not-for-production",
      AUTH_URL: `http://localhost:${PORT}`,
      // 별도 워커 없이 웹 프로세스가 변환 작업을 처리한다 (.env의 REDIS_URL을 무시)
      CONVERSION_QUEUE: process.env.CONVERSION_QUEUE || "inline",
    },
  },
});
