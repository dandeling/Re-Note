import type { NextConfig } from "next";

/** 서식 글꼴(@fontsource)은 server/format-fonts.ts가 런타임에 디스크에서 읽는다: 400·700 굵기의 CSS와 woff2만 쓴다. */
const FONT_FILES = [
  "./node_modules/@fontsource/*/{400,700}.css",
  "./node_modules/@fontsource/*/files/*-{400,700}-normal.woff2",
];

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
  // 번들하지 않고 Node의 require로 불러올 패키지 (node_modules/next/dist/docs/.../serverExternalPackages.md).
  // playwright·pg·@prisma/client는 Next 기본 목록에 이미 있다. bullmq는 Lua 스크립트 파일을 디스크에서 읽고
  // ioredis와 함께 서버리스(Vercel)에서는 쓰이지 않으므로(서버 변환 꺼짐) 번들에서 뺀다.
  serverExternalPackages: ["bullmq", "ioredis"],
  // 서버리스 함수에 넣을 파일 (Vercel). 글꼴은 경로를 런타임에 조립해 읽으므로 추적이 놓칠 수 있다.
  outputFileTracingIncludes: {
    "/api/format-fonts": FONT_FILES,
    "/api/format-fonts/**": FONT_FILES,
    "/api/docs/**": FONT_FILES,
  },
  // 함수 크기 제한을 넘지 않게 쓰지 않는 큰 파일은 뺀다: 다른 굵기·woff 글꼴, 브라우저 테스트 도구, 변환 워커.
  outputFileTracingExcludes: {
    "/**": [
      "./node_modules/@fontsource/*/files/*-{100,200,300,500,600,800,900}-*",
      "./node_modules/@fontsource/*/files/*.woff",
      "./node_modules/@fontsource/*/files/*-italic.woff2",
      "./node_modules/@playwright/test/**",
      "./node_modules/@axe-core/**",
      "./worker/**",
      "./pyhwp-*.tar.gz",
    ],
  },
};

export default nextConfig;
