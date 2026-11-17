import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 거의 모든 화면이 사용자별 동적 데이터라 cacheComponents(부분 사전 렌더링)는 끈다. docs/decisions.md #13
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
