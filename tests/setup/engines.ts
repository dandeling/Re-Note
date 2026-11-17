import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach } from "vitest";
import { FIXTURES } from "./storage";

export function hasCommand(name: string) {
  try {
    execFileSync("sh", ["-c", `command -v ${name}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export const HAS_SOFFICE = hasCommand(process.env.SOFFICE_BIN || "soffice");
export const HAS_POPPLER = hasCommand("pdfinfo") && hasCommand("pdftotext") && hasCommand("pdftohtml");
export const HAS_HWP5HTML = hasCommand(process.env.HWP5HTML_BIN || "hwp5html");
export const HAS_UNHWP = (() => {
  try {
    execFileSync(process.env.UNHWP_PYTHON || "python3", ["-c", "import unhwp"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

/** 가짜 엔진 스크립트 (tests/fixtures/engines) */
export const fakeEngine = (name: "hang" | "fail" | "crash" | "empty-pdf" | "garbage-pdf") =>
  path.join(FIXTURES, "engines", `${name}.sh`);

/** 제3자 HWP 샘플 (worker/spike/fetch-samples.sh로 내려받는다. 없으면 관련 테스트는 건너뛴다) */
export const THIRD_PARTY_DIR = path.join(FIXTURES, "hwp", "third-party");
export const THIRD_PARTY_SAMPLES = [
  "sample-5017",
  "footnote-endnote",
  "multicolumns",
  "matrix",
  "textbox",
  "shapepict-scaled",
  "charshape",
  "facename",
  "pagedefs",
].filter((name) => existsSync(path.join(THIRD_PARTY_DIR, `${name}.hwp`)));

/** 테스트가 바꾼 환경변수를 테스트가 끝나면 되돌린다. 파일 최상위에서 한 번 호출하고 돌려받은 함수로 값을 바꾼다. */
export function scopedEnv() {
  const saved = new Map<string, string | undefined>();
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    saved.clear();
  });
  return (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (!saved.has(name)) saved.set(name, process.env[name]);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
