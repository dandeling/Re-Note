import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";

/**
 * 테스트 파일 단위로 임시 디렉터리를 로컬 스토리지로 쓴다 (S3 환경변수는 끈다).
 * 테스트 파일 최상위에서 `tempStorage()`를 호출한다.
 */
export function tempStorage() {
  let dir = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "rm-storage-"));
    for (const name of ["STORAGE_LOCAL_DIR", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_ENDPOINT"]) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    process.env.STORAGE_LOCAL_DIR = dir;
  });
  afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });
}

export const FIXTURES = path.resolve(import.meta.dirname, "../fixtures");

export function fixture(relative: string) {
  return readFileSync(path.join(FIXTURES, relative));
}

/** multipart/form-data 요청 (파일 업로드) */
export function formRequest(url: string, fields: Record<string, string | { name: string; bytes: Uint8Array }>, headers?: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") form.set(key, value);
    else form.set(key, new File([new Uint8Array(value.bytes)], value.name));
  }
  return new Request(`http://localhost${url}`, { method: "POST", body: form, headers });
}
