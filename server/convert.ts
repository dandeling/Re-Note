import type { Asset, ConversionJob } from "@/lib/generated/prisma/client";
import { messages } from "@/lib/messages";
import { ApiError } from "@/server/api";
import { createAssetFromBytes } from "@/server/assets";
import { createJob } from "@/server/jobs/jobs";
import { clientIp, rateLimit, ruleFromEnv } from "@/server/rate-limit";
import { readUploadedFile } from "@/server/upload-form";

/** 변환·가져오기 요청 한도: IP(로그인 시 사용자)당 시간당 20회 */
export const CONVERT_RATE_RULE = { limit: 20, windowMs: 60 * 60_000 };

export async function limitConversions(req: Request, userId: string | null) {
  await rateLimit(`convert:${userId ?? clientIp(req)}`, ruleFromEnv("RATE_LIMIT_CONVERT_PER_HOUR", CONVERT_RATE_RULE));
}

/** 선택적 로그인: 로그인했으면 사용자, 아니면 null */
export async function optionalUser() {
  const { getCurrentUser } = await import("@/server/session");
  return getCurrentUser();
}

/**
 * HWP/HWPX → PDF 변환 요청 (/tools/convert). 로그인하지 않아도 된다.
 * 로그인 사용자의 작업은 그 사용자만, 익명 작업은 작업 ID를 아는 사람만 조회할 수 있다.
 */
export async function startConversion(req: Request, userId: string | null) {
  const { filename, bytes } = await readUploadedFile(req);
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".hwp") && !lower.endsWith(".hwpx")) throw new ApiError("UNSUPPORTED_FILE", messages.convert.onlyHwp);
  const asset = await createAssetFromBytes({ ownerId: userId, filename, bytes, allowed: ["hwp", "hwpx"] });
  return createJob({ ownerId: userId, inputAssetId: asset.id, type: "HWP_TO_PDF" });
}

/** 상태 폴링 응답. 내부 사유(엔진 stderr 등)는 내보내지 않는다. */
export function conversionView(job: ConversionJob & { inputAsset: Asset; outputAsset?: Asset | null }) {
  const result = (job.result ?? {}) as { pages?: number | null; code?: string };
  const done = job.status === "DONE" && job.outputAssetId;
  return {
    id: job.id,
    status: job.status,
    filename: job.inputAsset.filename,
    error: job.status === "FAILED" ? job.error : null,
    code: job.status === "FAILED" ? (result.code ?? null) : null,
    pages: done ? (result.pages ?? null) : null,
    outputFilename: done ? (job.outputAsset?.filename ?? null) : null,
    previewUrl: done ? `/api/convert/${job.id}/file` : null,
    downloadUrl: done ? `/api/convert/${job.id}/file?download=1` : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
