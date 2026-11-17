import type { z } from "zod";
import { prisma } from "@/lib/db";
import { FILE_TYPES, fileTypeOf, matchesMagic, maxUploadBytes, type FileExt } from "@/lib/files/types";
import type { Asset } from "@/lib/generated/prisma/client";
import { log } from "@/lib/log";
import { messages } from "@/lib/messages";
import { getStorage, newStorageKey } from "@/lib/storage";
import type { completeUploadSchema, uploadUrlSchema } from "@/lib/validation/asset";
import { getOwnedProject } from "@/server/access";
import { ApiError, notFound } from "@/server/api";

const UPLOAD_URL_TTL_SECONDS = 600;
const MAGIC_HEAD_BYTES = 4096;

function mb(bytes: number) {
  return Math.floor(bytes / 1024 / 1024);
}

/** 확장자와 용량을 검사한다. 통과하면 파일 형식을 돌려준다. */
export function checkUploadMeta(filename: string, size: number, allowed?: readonly FileExt[]): FileExt {
  const ext = fileTypeOf(filename);
  if (!ext || (allowed && !allowed.includes(ext))) throw new ApiError("UNSUPPORTED_FILE", messages.assets.unsupported);
  if (size > maxUploadBytes()) {
    throw new ApiError("PAYLOAD_TOO_LARGE", messages.assets.tooLarge.replace("{mb}", String(mb(maxUploadBytes()))));
  }
  if (size <= 0) throw new ApiError("VALIDATION_ERROR", messages.assets.empty);
  return ext;
}

function checkMagic(ext: FileExt, head: Uint8Array) {
  if (!matchesMagic(ext, head)) throw new ApiError("UNSUPPORTED_FILE", messages.assets.magicMismatch);
}

function uploadPrefix(userId: string) {
  return `uploads/${userId}`;
}

/** 1단계: 브라우저가 스토리지로 직접 올릴 presigned PUT URL을 만든다. */
export async function createUploadUrl(userId: string, input: z.infer<typeof uploadUrlSchema>) {
  const ext = checkUploadMeta(input.filename, input.size);
  if (input.projectId) await getOwnedProject(userId, input.projectId);
  const key = newStorageKey(uploadPrefix(userId), input.filename);
  const contentType = FILE_TYPES[ext].mime;
  const uploadUrl = await getStorage().presign(key, { method: "PUT", expiresIn: UPLOAD_URL_TTL_SECONDS, contentType });
  return { uploadUrl, key, method: "PUT" as const, headers: { "content-type": contentType }, expiresIn: UPLOAD_URL_TTL_SECONDS };
}

/**
 * 2단계: 올라온 객체를 검사하고 Asset을 만든다.
 * presigned URL은 용량·내용을 강제하지 못하므로 여기서 실제 크기와 매직바이트를 다시 확인하고,
 * 통과하지 못한 객체는 스토리지에서 지운다.
 */
export async function completeUpload(userId: string, input: z.infer<typeof completeUploadSchema>): Promise<Asset> {
  // 자기 업로드 경로의 키만 받는다 (남의 객체를 자기 자산으로 등록하지 못하게).
  if (!input.key.startsWith(`${uploadPrefix(userId)}/`)) notFound();
  const ext = fileTypeOf(input.filename);
  if (!ext || fileTypeOf(input.key) !== ext) throw new ApiError("UNSUPPORTED_FILE", messages.assets.unsupported);
  if (input.projectId) await getOwnedProject(userId, input.projectId);

  const existing = await prisma.asset.findUnique({ where: { storageKey: input.key } });
  if (existing) return existing;

  const storage = getStorage();
  const info = await storage.head(input.key);
  if (!info) throw new ApiError("NOT_FOUND", messages.assets.notUploaded);
  try {
    checkUploadMeta(input.filename, info.size);
    checkMagic(ext, await storage.get(input.key, { firstBytes: MAGIC_HEAD_BYTES }));
  } catch (err) {
    await storage.delete(input.key).catch(() => undefined);
    log.warn("asset.rejected", { userId, ext, size: info.size, reason: err instanceof ApiError ? err.code : String(err) });
    throw err;
  }
  return prisma.asset.create({
    data: {
      ownerId: userId,
      projectId: input.projectId ?? null,
      kind: FILE_TYPES[ext].kind,
      storageKey: input.key,
      filename: input.filename,
      size: info.size,
      mime: FILE_TYPES[ext].mime,
    },
  });
}

/**
 * 서버가 이미 바이트를 가지고 있을 때(멀티파트 업로드, 변환 결과 등) 같은 검사를 거쳐 Asset을 만든다.
 * ownerId가 null이면 익명 자산이다 (/tools/convert).
 */
export async function createAssetFromBytes(input: {
  ownerId: string | null;
  projectId?: string | null;
  filename: string;
  bytes: Uint8Array;
  allowed?: readonly FileExt[];
  keyPrefix?: string;
}): Promise<Asset> {
  const ext = checkUploadMeta(input.filename, input.bytes.byteLength, input.allowed);
  checkMagic(ext, input.bytes.subarray(0, MAGIC_HEAD_BYTES));
  const key = newStorageKey(input.keyPrefix ?? (input.ownerId ? uploadPrefix(input.ownerId) : "anonymous"), input.filename);
  await getStorage().put(key, input.bytes, { contentType: FILE_TYPES[ext].mime });
  return prisma.asset.create({
    data: {
      ownerId: input.ownerId,
      projectId: input.projectId ?? null,
      kind: FILE_TYPES[ext].kind,
      storageKey: key,
      filename: input.filename,
      size: input.bytes.byteLength,
      mime: FILE_TYPES[ext].mime,
    },
  });
}

/** API 응답용 자산 정보 (`lib/upload-client.ts`의 `UploadedAsset`과 같은 모양) */
export function assetView(asset: Asset) {
  return {
    id: asset.id,
    kind: asset.kind,
    filename: asset.filename,
    size: asset.size,
    mime: asset.mime,
    projectId: asset.projectId,
    url: `/api/assets/${asset.id}`,
  };
}

/** 소유자 검사. 남의 자산·휴지통의 자산은 404. */
export async function getOwnedAsset(userId: string, assetId: string): Promise<Asset> {
  const asset = await prisma.asset.findFirst({
    where: {
      id: assetId,
      ownerId: userId,
      deletedAt: null,
      OR: [{ projectId: null }, { project: { ownerId: userId, deletedAt: null } }],
    },
  });
  if (!asset) notFound();
  return asset;
}

export function readAsset(asset: Pick<Asset, "storageKey">) {
  return getStorage().get(asset.storageKey);
}

const INLINE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

/** 자산 내용을 응답으로 내보낸다. 브라우저가 실행할 수 있는 형식으로 해석하지 못하게 헤더를 고정한다. */
export function fileResponse(bytes: Uint8Array, opts: { filename: string; mime: string; download?: boolean }) {
  const textLike = opts.mime.startsWith("text/");
  const inline = !opts.download && (INLINE_MIMES.has(opts.mime) || textLike);
  const asciiName = opts.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": textLike ? "text/plain; charset=utf-8" : opts.mime,
      "content-length": String(bytes.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(opts.filename)}`,
      "x-content-type-options": "nosniff",
      ...(opts.mime === "application/pdf" ? {} : { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" }),
      "cache-control": "private, max-age=300",
    },
  });
}
