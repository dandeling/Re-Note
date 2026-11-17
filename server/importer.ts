import { z } from "zod";
import { fileTypeOf, type FileExt } from "@/lib/files/types";
import type { Asset, ConversionJob, ConversionType } from "@/lib/generated/prisma/client";
import { noteText, type ImportNote } from "@/lib/importer/notes";
import { messages } from "@/lib/messages";
import { getOwnedDocument, getOwnedProject } from "@/server/access";
import { ApiError, notFound } from "@/server/api";
import { createAssetFromBytes } from "@/server/assets";
import { CONVERT_RATE_RULE } from "@/server/convert";
import type { ImportResult } from "@/server/jobs/import";
import { createJob, getViewableJob } from "@/server/jobs/jobs";
import { rateLimit, ruleFromEnv } from "@/server/rate-limit";
import { readUploadedFile } from "@/server/upload-form";

/** 가져올 수 있는 형식과 작업 유형 */
const IMPORT_TYPES: Partial<Record<FileExt, ConversionType>> = {
  md: "IMPORT_MD",
  docx: "IMPORT_DOCX",
  pdf: "IMPORT_PDF",
  hwp: "IMPORT_HWP",
  hwpx: "IMPORT_HWP",
};
export const IMPORT_EXTENSIONS = Object.keys(IMPORT_TYPES) as FileExt[];
const IMPORT_JOB_TYPES = new Set<ConversionType>(Object.values(IMPORT_TYPES));

const importFieldsSchema = z.object({
  projectId: z.string().min(1).max(64),
  documentId: z.string().min(1).max(64).optional(),
  title: z.string().trim().max(200).optional(),
});

/**
 * 가져오기 요청 (multipart: file, projectId, documentId?, title?). 로그인 필수, 프로젝트·문서 소유자만.
 * 원본 파일은 프로젝트 자산으로 저장되고(원본 미리보기·첨부), 처리는 변환 워커가 한다.
 */
export async function startImport(req: Request, userId: string) {
  await rateLimit(`import:${userId}`, ruleFromEnv("RATE_LIMIT_CONVERT_PER_HOUR", CONVERT_RATE_RULE));
  const { filename, bytes, form } = await readUploadedFile(req);
  const fields = importFieldsSchema.parse({
    projectId: form.get("projectId") ?? undefined,
    documentId: form.get("documentId") || undefined,
    title: form.get("title") || undefined,
  });
  await getOwnedProject(userId, fields.projectId);
  if (fields.documentId) {
    const doc = await getOwnedDocument(userId, fields.documentId);
    if (doc.projectId !== fields.projectId) notFound();
  }
  const ext = fileTypeOf(filename);
  const type = ext ? IMPORT_TYPES[ext] : undefined;
  if (!type) throw new ApiError("UNSUPPORTED_FILE", messages.importer.unsupported);
  const asset = await createAssetFromBytes({ ownerId: userId, projectId: fields.projectId, filename, bytes, allowed: IMPORT_EXTENSIONS });
  return createJob({
    ownerId: userId,
    inputAssetId: asset.id,
    type,
    params: { projectId: fields.projectId, ...(fields.documentId ? { documentId: fields.documentId } : {}), ...(fields.title ? { title: fields.title } : {}) },
  });
}

/** 가져오기 작업 조회 (본인만). 다른 사람의 작업·변환 작업은 404. */
export async function getImportJob(userId: string, jobId: string) {
  const job = await getViewableJob(userId, jobId);
  if (!IMPORT_JOB_TYPES.has(job.type) || job.ownerId !== userId) notFound();
  return job;
}

export function importView(job: ConversionJob & { inputAsset: Asset }) {
  const result = job.status === "DONE" ? (job.result as ImportResult | null) : null;
  const notes = (result?.notes ?? []) as ImportNote[];
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    filename: job.inputAsset.filename,
    error: job.status === "FAILED" ? job.error : null,
    mode: result?.mode ?? null,
    projectId: result?.projectId ?? (job.params as { projectId?: string } | null)?.projectId ?? null,
    documentId: result?.documentId ?? null,
    stats: result?.stats ?? null,
    notes: notes.map((note) => ({ code: note.code, text: noteText(note) })),
    original: { url: `/api/assets/${job.inputAsset.id}`, kind: job.inputAsset.kind, mime: job.inputAsset.mime },
    previewUrl: result?.previewAssetId ? `/api/assets/${result.previewAssetId}` : null,
  };
}
