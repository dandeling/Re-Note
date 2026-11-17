/**
 * 파일 스토리지 (SPEC 4장 "S3 호환 스토리지").
 *
 * 사용법 — 서버 코드(라우트 핸들러, 워커)에서만 쓴다:
 *
 *   import { getStorage, newStorageKey } from "@/lib/storage";
 *   const storage = getStorage();
 *   const key = newStorageKey("datasets", "측정값.csv");        // "datasets/<무작위>/file.csv"
 *   await storage.put(key, bytes, { contentType: "text/csv" });
 *   const bytes = await storage.get(key);                        // Buffer, 없으면 StorageNotFoundError
 *   const head = await storage.get(key, { firstBytes: 4096 });   // 앞부분만
 *   const info = await storage.head(key);                        // { size } | null
 *   await storage.delete(key);                                   // 없어도 오류 없음
 *   const url = await storage.presign(key, { method: "GET" });   // 브라우저용 임시 URL ("PUT"도 가능)
 *
 * 사용자가 올리는 파일은 직접 put하지 말고 업로드 API를 쓴다. 확장자·매직바이트·용량·소유자 검사를 거쳐
 * Asset 행이 만들어진다:
 *   - 브라우저: `uploadAsset(file, { projectId })` (lib/upload-client.ts)
 *       = POST /api/assets/upload-url → 받은 URL로 PUT → POST /api/assets/complete → { asset }
 *   - 서버가 바이트를 이미 가지고 있을 때: `createAssetFromBytes()` (server/assets.ts)
 *   - 자산 읽기: 서버는 `getOwnedAsset()` + `readAsset()` (server/assets.ts), 브라우저는 GET /api/assets/:id
 *
 * 드라이버 선택: S3_BUCKET·S3_ACCESS_KEY·S3_SECRET_KEY가 모두 있으면 S3 호환 드라이버(운영·MinIO),
 * 아니면 로컬 파일시스템 드라이버(STORAGE_LOCAL_DIR, 기본 `.data/storage`).
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { Storage } from "./types";

export type { GetOptions, PresignOptions, Storage } from "./types";
export { StorageNotFoundError } from "./types";

let cached: { signature: string; storage: Storage } | null = null;

export function getStorage(): Storage {
  const env = process.env;
  const signature = [
    env.S3_ENDPOINT,
    env.S3_PUBLIC_ENDPOINT,
    env.S3_BUCKET,
    env.S3_ACCESS_KEY,
    env.S3_SECRET_KEY,
    env.S3_REGION,
    env.STORAGE_LOCAL_DIR,
  ].join("|");
  if (cached?.signature === signature) return cached.storage;
  const storage: Storage =
    env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY
      ? new S3Storage({
          endpoint: env.S3_ENDPOINT || undefined,
          publicEndpoint: env.S3_PUBLIC_ENDPOINT || undefined,
          region: env.S3_REGION || "us-east-1",
          bucket: env.S3_BUCKET,
          accessKeyId: env.S3_ACCESS_KEY,
          secretAccessKey: env.S3_SECRET_KEY,
        })
      : new LocalStorage(path.resolve(env.STORAGE_LOCAL_DIR || ".data/storage"));
  cached = { signature, storage };
  return storage;
}

/** 추측할 수 없는 새 스토리지 키. 원본 파일명은 키에 넣지 않고 확장자만 남긴다. */
export function newStorageKey(prefix: string, filename: string) {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1]?.toLowerCase();
  return `${prefix}/${randomBytes(16).toString("hex")}/file${ext ? `.${ext}` : ""}`;
}
