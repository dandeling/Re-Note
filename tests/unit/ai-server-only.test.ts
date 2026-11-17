import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// P7-6: AI 키를 다루는 모듈이 클라이언트 번들로 새지 않도록 하는 정적 가드.
// 실제 빌드 산출물 검사는 `pnpm test:bundle`(scripts/check-bundle.ts)이 한다.

const root = path.resolve(import.meta.dirname, "../..");

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx)$/.test(name)) yield full;
  }
}

const rel = (file: string) => path.relative(root, file);
/** 클라이언트에서 써도 되는 유일한 lib/ai 모듈 (타입·상수만) */
const CLIENT_SAFE = "lib/ai/shared.ts";

describe("AI 모듈 server-only 가드", () => {
  const aiFiles = [...sourceFiles(path.join(root, "lib/ai"))];

  it("lib/ai의 모듈은 shared.ts를 빼고 모두 첫 줄에서 server-only를 import한다", () => {
    expect(aiFiles.length).toBeGreaterThan(1);
    for (const file of aiFiles) {
      if (rel(file) === CLIENT_SAFE) continue;
      const firstStatement = readFileSync(file, "utf8")
        .split("\n")
        .find((line) => line.trim() && !line.trim().startsWith("//"));
      expect(firstStatement, rel(file)).toBe('import "server-only";');
    }
  });

  it("ANTHROPIC_API_KEY를 읽는 코드는 lib/ai/client.ts 하나뿐이다", () => {
    const readers = ["app", "components", "lib", "server"]
      .flatMap((dir) => [...sourceFiles(path.join(root, dir))])
      .filter((f) => /process\.env(\.ANTHROPIC_API_KEY|\[["']ANTHROPIC_API_KEY)/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(readers).toEqual(["lib/ai/client.ts"]);
  });

  it("shared.ts는 서버 코드·환경변수를 참조하지 않는다", () => {
    const text = readFileSync(path.join(root, CLIENT_SAFE), "utf8");
    expect(text).not.toMatch(/^import(?! type)/m);
    expect(text).not.toContain("process.env");
  });

  it("클라이언트 컴포넌트는 lib/ai의 서버 모듈을 import하지 않고 ANTHROPIC 환경변수를 참조하지 않는다", () => {
    const clientFiles = ["app", "components", "lib"].flatMap((dir) =>
      [...sourceFiles(path.join(root, dir))].filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8"))),
    );
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const file of clientFiles) {
      const text = readFileSync(file, "utf8");
      const aiImports = [...text.matchAll(/from\s+["']@\/lib\/ai\/([\w-]+)["']/g)].map((m) => m[1]);
      expect(aiImports.filter((m) => m !== "shared"), rel(file)).toEqual([]);
      expect(text, rel(file)).not.toMatch(/ANTHROPIC/);
    }
  });
});
