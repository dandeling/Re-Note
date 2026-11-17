import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      // `server-only`는 Next 번들러 밖(Vitest)에서는 무조건 throw하므로 빈 모듈로 대체한다.
      "server-only": path.resolve(import.meta.dirname, "tests/setup/server-only.ts"),
    },
  },
  test: {
    exclude: ["**/node_modules/**", ".claude/**"],
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    environment: "node",
    globalSetup: ["tests/setup/global.ts"],
    setupFiles: ["tests/setup/env.ts"],
    // 통합 테스트가 하나의 테스트 DB를 공유하므로 파일 단위로 순차 실행한다.
    fileParallelism: false,
  },
});
