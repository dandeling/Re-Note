import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { looksLikeHwp, looksLikeHwpx } from "@/lib/conversion/precheck";
import { ConversionError, conversionTimeoutMs, convertToPdf, type Attempt, type ConversionFailureCode } from "@/lib/conversion/to-pdf";
import { prisma } from "@/lib/db";
import type { Asset, ConversionJob, Prisma } from "@/lib/generated/prisma/client";
import { log } from "@/lib/log";
import { messages } from "@/lib/messages";
import { getStorage } from "@/lib/storage";
import { createAssetFromBytes } from "@/server/assets";

export type JobContext = { workDir: string; deadline: number };
export type JobWithInput = ConversionJob & { inputAsset: Asset };
export type JobOutcome = { outputAssetId?: string | null; result: Record<string, unknown> };

/** 사용자에게 보여 줄 실패 사유 (SPEC 7.3 a "실패 시 사유 표시") */
export function failureMessage(type: ConversionJob["type"], code: ConversionFailureCode | "TARGET_GONE") {
  const table: Record<string, string> = type === "HWP_TO_PDF" ? messages.convert.errors : messages.importer.errors;
  return table[code] ?? table.INTERNAL;
}

/** HWP/HWPX → PDF (/tools/convert) */
async function hwpToPdf(job: JobWithInput, ctx: JobContext): Promise<JobOutcome> {
  const kind = job.inputAsset.kind === "HWPX" ? "hwpx" : "hwp";
  const bytes = await getStorage().get(job.inputAsset.storageKey);
  if (!(kind === "hwp" ? looksLikeHwp(bytes) : looksLikeHwpx(bytes))) throw new ConversionError("CORRUPT");
  const input = path.join(ctx.workDir, `input.${kind}`);
  await writeFile(input, bytes);
  const pdf = await convertToPdf({ input, kind, workDir: ctx.workDir, deadline: ctx.deadline });
  const output = await createAssetFromBytes({
    ownerId: job.ownerId,
    filename: `${job.inputAsset.filename.replace(/\.[^.]+$/, "")}.pdf`,
    bytes: await readFile(pdf.pdfPath),
    keyPrefix: "converted",
  });
  return { outputAssetId: output.id, result: { engine: pdf.engine, pages: pdf.pages, attempts: pdf.attempts } };
}

async function runHandler(job: JobWithInput, ctx: JobContext): Promise<JobOutcome> {
  if (job.type === "HWP_TO_PDF") return hwpToPdf(job, ctx);
  const { runImportJob } = await import("@/server/jobs/import");
  return runImportJob(job, ctx);
}

/**
 * 변환 작업 하나를 처리한다: QUEUED → RUNNING → DONE | FAILED.
 * 워커(BullMQ 소비자)와 inline 모드가 함께 쓴다. 예외를 밖으로 던지지 않는다.
 *
 * - QUEUED인 작업만 원자적으로 집는다(같은 작업이 두 번 처리되지 않는다).
 * - 전체 제한 시간(기본 120초)이 지나면 엔진 프로세스를 죽이고 FAILED(TIMEOUT)로 기록한다.
 * - 끝날 때마다 `conversion.job` 구조화 로그를 남긴다. 실패율 = status가 FAILED인 로그 / 전체.
 */
export async function processJob(jobId: string): Promise<void> {
  const claimed = await prisma.conversionJob.updateMany({ where: { id: jobId, status: "QUEUED" }, data: { status: "RUNNING" } });
  if (claimed.count === 0) return;
  const started = Date.now();
  const deadline = started + conversionTimeoutMs();
  let type: ConversionJob["type"] | "UNKNOWN" = "UNKNOWN";
  let workDir: string | null = null;
  let guard: NodeJS.Timeout | undefined;

  try {
    const job = await prisma.conversionJob.findUniqueOrThrow({ where: { id: jobId }, include: { inputAsset: true } });
    type = job.type;
    workDir = await mkdtemp(path.join(tmpdir(), "rm-job-"));
    // 엔진마다 남은 시간을 넘겨 주지만, 만약을 위해 전체 작업에도 마감 시간을 건다.
    const overall = new Promise<never>((_, reject) => {
      guard = setTimeout(() => reject(new ConversionError("TIMEOUT")), deadline - Date.now() + 3000);
    });
    const outcome = await Promise.race([runHandler(job, { workDir, deadline }), overall]);
    await prisma.conversionJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: { status: "DONE", outputAssetId: outcome.outputAssetId ?? null, result: outcome.result as Prisma.InputJsonValue, error: null },
    });
    log.info("conversion.job", { jobId, type, status: "DONE", ms: Date.now() - started, ...summarize(outcome.result) });
  } catch (err) {
    const code: ConversionFailureCode | "TARGET_GONE" =
      err instanceof ConversionError ? err.code : err instanceof ImportTargetGoneError ? "TARGET_GONE" : "INTERNAL";
    const attempts: Attempt[] = err instanceof ConversionError ? err.attempts : [];
    await prisma.conversionJob
      .updateMany({
        where: { id: jobId, status: "RUNNING" },
        data: {
          status: "FAILED",
          error: failureMessage(type === "UNKNOWN" ? "HWP_TO_PDF" : type, code),
          result: { code, attempts } as Prisma.InputJsonValue,
        },
      })
      .catch((dbErr) => log.error("conversion.job_update_failed", { jobId, error: String(dbErr) }));
    log.warn("conversion.job", {
      jobId,
      type,
      status: "FAILED",
      code,
      ms: Date.now() - started,
      attempts,
      ...(code === "INTERNAL" ? { error: String(err) } : {}),
    });
  } finally {
    clearTimeout(guard);
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function summarize(result: Record<string, unknown>) {
  const { engine, pages, attempts } = result;
  return { engine, pages, attempts };
}

/** 가져오기 대상 문서가 그사이 사라졌을 때 */
export class ImportTargetGoneError extends Error {}

/** RUNNING인 채로 이 시간을 넘기면 워커가 죽은 것으로 본다. */
function staleRunningMs() {
  return conversionTimeoutMs() + 30_000;
}
const STALE_QUEUED_MS = 15 * 60_000;

/**
 * 워커 크래시 등으로 끝나지 못한 작업을 FAILED로 바꾼다 (크래시를 실패로 처리).
 * 상태 조회(GET /api/convert/:jobId)와 워커의 주기 점검에서 부른다.
 */
export async function failStaleJobs(jobId?: string, now = Date.now()) {
  const only = jobId ? { id: jobId } : {};
  const stale = await prisma.conversionJob.findMany({
    where: {
      ...only,
      OR: [
        { status: "RUNNING", updatedAt: { lt: new Date(now - staleRunningMs()) } },
        { status: "QUEUED", updatedAt: { lt: new Date(now - STALE_QUEUED_MS) } },
      ],
    },
    select: { id: true, type: true, status: true },
  });
  for (const job of stale) {
    const code = job.status === "RUNNING" ? "CRASHED" : "NO_ENGINE";
    const updated = await prisma.conversionJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "FAILED", error: failureMessage(job.type, code), result: { code, attempts: [] } },
    });
    if (updated.count > 0) log.warn("conversion.job", { jobId: job.id, type: job.type, status: "FAILED", code, stale: true });
  }
  return stale.length;
}
