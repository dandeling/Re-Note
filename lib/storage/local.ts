import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertValidKey, StorageNotFoundError, type GetOptions, type PresignOptions, type Storage } from "./types";

/** 프로세스마다 달라지는 임시 서명 키 (AUTH_SECRET이 없을 때만 사용) */
const fallbackSecret = randomBytes(32).toString("hex");

function sign(method: string, key: string, exp: number) {
  return createHmac("sha256", process.env.AUTH_SECRET || fallbackSecret)
    .update(`${method}\n${key}\n${exp}`)
    .digest("hex");
}

/** 로컬 드라이버의 presigned URL 서명을 검증한다 (app/api/storage/local 라우트가 사용). */
export function verifyLocalSignature(method: string, key: string, exp: number, sig: string, now = Date.now()) {
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = Buffer.from(sign(method, key, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function isMissing(err: unknown) {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

/**
 * 로컬 파일시스템 드라이버 (개발·테스트용). S3 환경변수가 없을 때 쓰인다.
 * presign()은 서명된 `/api/storage/local/<key>` 경로(상대 URL)를 돌려준다.
 */
export class LocalStorage implements Storage {
  readonly driver = "local" as const;
  constructor(private readonly root: string) {}

  private file(key: string) {
    assertValidKey(key);
    return path.join(this.root, key);
  }

  async put(key: string, body: Uint8Array) {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string, opts: GetOptions = {}) {
    const file = this.file(key);
    try {
      if (opts.firstBytes === undefined) return await readFile(file);
      const handle = await open(file, "r");
      try {
        const buffer = Buffer.alloc(opts.firstBytes);
        const { bytesRead } = await handle.read(buffer, 0, opts.firstBytes, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } catch (err) {
      if (isMissing(err)) throw new StorageNotFoundError(key);
      throw err;
    }
  }

  async head(key: string) {
    try {
      const info = await stat(this.file(key));
      return info.isFile() ? { size: info.size } : null;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }

  async presign(key: string, opts: PresignOptions) {
    assertValidKey(key);
    const exp = Math.floor(Date.now() / 1000) + (opts.expiresIn ?? 600);
    const query = new URLSearchParams({ exp: String(exp), sig: sign(opts.method, key, exp) });
    return `/api/storage/local/${key}?${query}`;
  }
}
