import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type { ConversionJob, ConversionType, Prisma } from "@/lib/generated/prisma/client";
import { notFound } from "@/server/api";
import { failStaleJobs } from "@/server/jobs/process";
import { enqueueJob } from "@/server/jobs/queue";

/**
 * 작업을 만들고 큐에 넣는다.
 * 작업 ID는 추측할 수 없는 128비트 난수다 — 익명 작업은 이 ID를 아는 사람만 조회할 수 있다.
 */
export async function createJob(input: {
  ownerId: string | null;
  inputAssetId: string;
  type: ConversionType;
  params?: Record<string, unknown>;
  /** false면 큐에 넣지 않는다 (호출한 쪽이 직접 processJob을 부를 때) */
  enqueue?: boolean;
}): Promise<ConversionJob> {
  const job = await prisma.conversionJob.create({
    data: {
      id: randomBytes(16).toString("hex"),
      ownerId: input.ownerId,
      inputAssetId: input.inputAssetId,
      type: input.type,
      params: (input.params ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  if (input.enqueue !== false) await enqueueJob(job.id);
  return job;
}

/**
 * 조회 권한: 로그인 사용자의 작업은 본인만, 익명 작업(ownerId 없음)은 ID를 아는 누구나.
 * 그 밖에는 존재를 숨기려고 404.
 */
export async function getViewableJob(viewerId: string | null, jobId: string) {
  if (!/^[0-9a-z]{16,64}$/.test(jobId)) notFound();
  await failStaleJobs(jobId);
  const job = await prisma.conversionJob.findUnique({ where: { id: jobId }, include: { inputAsset: true, outputAsset: true } });
  if (!job || (job.ownerId !== null && job.ownerId !== viewerId)) notFound();
  return job;
}
