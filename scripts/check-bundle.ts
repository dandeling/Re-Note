// P7-6: API 키가 클라이언트 번들에 들어가지 않는지 확인한다 (SPEC 9장).
// 가짜 키(무작위 값)를 넣고 `next build`를 돌린 뒤, 브라우저로 내려가는 산출물(.next/static)에
// 키 값과 변수명(ANTHROPIC_API_KEY)이 없는지 검사한다. 빌드가 오래 걸려 `pnpm test`와 분리했다.
// 사용법: `pnpm test:bundle` (이미 빌드했으면 `pnpm test:bundle --skip-build`; 그 경우 키 값 검사는 건너뛴다)
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const staticDir = path.join(root, ".next", "static");
const skipBuild = process.argv.includes("--skip-build");
const fakeKey = `sk-ant-bundle-check-${randomBytes(12).toString("hex")}`;

if (!skipBuild) {
  console.log("next build 실행 중 (가짜 ANTHROPIC_API_KEY 사용)…");
  execFileSync("pnpm", ["exec", "next", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ANTHROPIC_API_KEY: fakeKey, ANTHROPIC_MODEL: "bundle-check-model", NODE_ENV: "production" },
  });
}

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

const needles = ["ANTHROPIC_API_KEY", ...(skipBuild ? [] : [fakeKey])];
const leaks: string[] = [];
let scanned = 0;
for (const file of files(staticDir)) {
  scanned += 1;
  const text = readFileSync(file, "latin1");
  for (const needle of needles) {
    if (text.includes(needle)) leaks.push(`${path.relative(root, file)}: ${needle === fakeKey ? "키 값" : needle}`);
  }
}

if (scanned === 0) {
  console.error(".next/static에 파일이 없습니다. 빌드를 확인하세요.");
  process.exit(1);
}
if (leaks.length > 0) {
  console.error(`클라이언트 번들에 API 키 정보가 들어 있습니다:\n${leaks.join("\n")}`);
  process.exit(1);
}
console.log(`OK: .next/static 파일 ${scanned}개에 ANTHROPIC_API_KEY${skipBuild ? "" : "와 키 값"}이 없습니다.`);
