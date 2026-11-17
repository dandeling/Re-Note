import { captureLogs } from "@/lib/log";
import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { createAssetFromBytes } from "@/server/assets";
import { createJob, getViewableJob } from "@/server/jobs/jobs";
import { failStaleJobs, processJob } from "@/server/jobs/process";
import { closeQueue, queueMode } from "@/server/jobs/queue";
import { startWorker } from "@/worker/index";
import { createUser, resetDb } from "../setup/db";
import { fakeEngine, HAS_POPPLER, hasCommand, scopedEnv } from "../setup/engines";
import { fixture, tempStorage } from "../setup/storage";

tempStorage();
const setEnv = scopedEnv();

async function makeJob(file: string, opts: { ownerId?: string | null; enqueue?: boolean } = {}) {
  const asset = await createAssetFromBytes({ ownerId: opts.ownerId ?? null, filename: file.split("/").pop()!, bytes: fixture(file) });
  return createJob({ ownerId: opts.ownerId ?? null, inputAssetId: asset.id, type: "HWP_TO_PDF", enqueue: opts.enqueue ?? false });
}

const reload = (id: string) => prisma.conversionJob.findUniqueOrThrow({ where: { id }, include: { outputAsset: true } });

async function waitForFinish(id: string, timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    const job = await reload(id);
    if (job.status === "DONE" || job.status === "FAILED") return job;
    if (Date.now() - started > timeoutMs) throw new Error(`job ${id} still ${job.status}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe.skipIf(!HAS_POPPLER)("변환 작업 처리 (P3-2)", () => {
  beforeEach(async () => {
    await resetDb();
    setEnv({ CONVERSION_QUEUE: "inline" });
  });

  it("QUEUED → RUNNING → DONE: 결과 PDF가 자산으로 저장되고 엔진·쪽수·시도 내역이 기록된다", async () => {
    const captured = captureLogs();
    const job = await makeJob("hwp/sample.hwp");
    expect(job.status).toBe("QUEUED");
    expect(job.id).toMatch(/^[0-9a-f]{32}$/);

    const running = processJob(job.id);
    await running;
    captured.restore();

    const done = await reload(job.id);
    expect(done.status).toBe("DONE");
    expect(done.error).toBeNull();
    expect(done.outputAsset).toMatchObject({ kind: "PDF", filename: "sample.pdf", mime: "application/pdf" });
    const pdf = await getStorage().get(done.outputAsset!.storageKey);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const result = done.result as { engine: string; pages: number; attempts: { engine: string; outcome: string }[] };
    expect(result.pages).toBeGreaterThanOrEqual(1);
    expect(result.attempts.at(-1)).toEqual(expect.objectContaining({ engine: result.engine, outcome: "ok" }));

    // 구조화 로그: 실패율을 집계할 수 있게 작업마다 한 줄
    const entry = captured.entries.find((l) => l.msg === "conversion.job");
    expect(entry).toMatchObject({ level: "info", jobId: job.id, type: "HWP_TO_PDF", status: "DONE", engine: result.engine });
    expect(typeof entry?.ms).toBe("number");
  }, 120_000);

  it("RUNNING 상태를 거친다", async () => {
    setEnv({ SOFFICE_BIN: fakeEngine("hang"), CONVERSION_ENGINES_HWPX: "libreoffice", CONVERSION_TIMEOUT_MS: "1500" });
    const job = await makeJob("hwp/sample.hwpx");
    const running = processJob(job.id);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await reload(job.id)).status).toBe("RUNNING");
    await running;
    expect((await reload(job.id)).status).toBe("FAILED");
  });

  it("타임아웃: 제한 시간을 넘기면 FAILED이고 사유가 기록된다", async () => {
    const captured = captureLogs();
    setEnv({ SOFFICE_BIN: fakeEngine("hang"), CONVERSION_ENGINES_HWPX: "libreoffice", CONVERSION_TIMEOUT_MS: "800" });
    const job = await makeJob("hwp/sample.hwpx");
    const started = Date.now();
    await processJob(job.id);
    captured.restore();
    expect(Date.now() - started).toBeLessThan(6000);
    const failed = await reload(job.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toContain("2분");
    expect(failed.result).toMatchObject({ code: "TIMEOUT", attempts: [{ engine: "libreoffice", outcome: "timeout" }] });
    expect(failed.outputAssetId).toBeNull();
    const entry = captured.entries.find((l) => l.msg === "conversion.job");
    expect(entry).toMatchObject({ level: "warn", jobId: job.id, status: "FAILED", code: "TIMEOUT" });
  });

  it("손상 파일: 매직바이트만 맞는 HWP·HWPX는 FAILED(CORRUPT)", async () => {
    for (const file of ["hwp/corrupt.hwp", "hwp/corrupt.hwpx", "hwp/truncated.hwpx"]) {
      const job = await makeJob(file);
      await processJob(job.id);
      const failed = await reload(job.id);
      expect(failed.status, file).toBe("FAILED");
      expect(failed.result, file).toMatchObject({ code: "CORRUPT" });
      expect(failed.error, file).toContain("손상");
    }
  });

  it("엔진 크래시: 모든 엔진이 죽으면 FAILED이고 시도 내역에 crashed가 남는다", async () => {
    setEnv({ SOFFICE_BIN: fakeEngine("crash"), CONVERSION_ENGINES_HWPX: "libreoffice" });
    const job = await makeJob("hwp/sample.hwpx");
    await processJob(job.id);
    const failed = await reload(job.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.result).toMatchObject({ code: "ENGINE_FAILED", attempts: [{ engine: "libreoffice", outcome: "crashed" }] });
    expect(failed.error).toBeTruthy();
  });

  it("엔진이 크래시해도 다음 엔진이 성공하면 DONE", async () => {
    setEnv({ SOFFICE_BIN: fakeEngine("crash") });
    const job = await makeJob("hwp/sample.hwpx");
    await processJob(job.id);
    const done = await reload(job.id);
    expect(done.status).toBe("DONE");
    expect(done.result).toMatchObject({ engine: "rhwp", attempts: [{ outcome: "crashed" }, { outcome: "ok" }] });
  }, 60_000);

  it("빈 PDF 감지: 종료 코드 0으로 빈 PDF를 낸 엔진 대신 다음 엔진의 결과를 쓴다", async () => {
    setEnv({ SOFFICE_BIN: fakeEngine("empty-pdf") });
    const job = await makeJob("hwp/sample.hwpx");
    await processJob(job.id);
    const done = await reload(job.id);
    expect(done.status).toBe("DONE");
    expect(done.result).toMatchObject({ engine: "rhwp", attempts: [{ engine: "libreoffice", outcome: "empty" }, { engine: "rhwp", outcome: "ok" }] });
  }, 60_000);

  it("같은 작업을 두 번 처리하지 않는다", async () => {
    setEnv({ SOFFICE_BIN: fakeEngine("fail"), CONVERSION_ENGINES_HWPX: "libreoffice" });
    const job = await makeJob("hwp/sample.hwpx");
    await Promise.all([processJob(job.id), processJob(job.id)]);
    const failed = await reload(job.id);
    expect((failed.result as { attempts: unknown[] }).attempts).toHaveLength(1);
    await processJob(job.id); // 이미 끝난 작업은 건드리지 않는다
    expect((await reload(job.id)).updatedAt).toEqual(failed.updatedAt);
  });

  it("워커 크래시: RUNNING인 채로 남은 작업은 FAILED(CRASHED)로 바뀐다", async () => {
    const job = await makeJob("hwp/sample.hwpx");
    await prisma.conversionJob.update({ where: { id: job.id }, data: { status: "RUNNING" } });
    expect(await failStaleJobs(job.id)).toBe(0); // 아직 제한 시간 안
    expect(await failStaleJobs(job.id, Date.now() + 151_000)).toBe(1);
    const failed = await reload(job.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.result).toMatchObject({ code: "CRASHED" });
    expect(failed.error).toContain("비정상 종료");
  });

  it("조회 권한: 익명 작업은 ID를 알면 누구나, 로그인 사용자의 작업은 본인만", async () => {
    const owner = await createUser("소유자");
    const other = await createUser("다른 사용자");
    const anonymous = await makeJob("hwp/sample.hwpx");
    const owned = await makeJob("hwp/sample.hwpx", { ownerId: owner.id });
    expect((await getViewableJob(null, anonymous.id)).id).toBe(anonymous.id);
    expect((await getViewableJob(other.id, anonymous.id)).id).toBe(anonymous.id);
    expect((await getViewableJob(owner.id, owned.id)).id).toBe(owned.id);
    await expect(getViewableJob(other.id, owned.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getViewableJob(null, owned.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getViewableJob(null, "0".repeat(32))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getViewableJob(null, "../etc")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/** 실제 Redis + BullMQ 소비자. 다른 에이전트와 겹치지 않게 전용 포트와 큐 prefix를 쓴다. */
const REDIS_PORT = Number(process.env.TEST_REDIS_PORT || 6402);

describe.skipIf(!HAS_POPPLER || !hasCommand("redis-server"))("BullMQ 워커 (실제 Redis)", () => {
  let redis: ChildProcess;
  let worker: ReturnType<typeof startWorker>;

  beforeAll(async () => {
    redis = spawn("redis-server", ["--port", String(REDIS_PORT), "--save", "", "--appendonly", "no", "--bind", "127.0.0.1"], { stdio: "pipe" });
    await new Promise<void>((resolve, reject) => {
      redis.stdout!.on("data", (chunk: Buffer) => chunk.toString().includes("Ready to accept connections") && resolve());
      redis.on("exit", (code) => reject(new Error(`redis-server exited with ${code}`)));
      setTimeout(() => reject(new Error("redis-server did not start")), 10_000);
    });
    process.env.REDIS_URL = `redis://127.0.0.1:${REDIS_PORT}`;
    process.env.QUEUE_PREFIX = `rm-convert-test-${process.pid}`;
    worker = startWorker();
  }, 20_000);

  afterAll(async () => {
    await worker?.stop();
    await closeQueue();
    delete process.env.REDIS_URL;
    delete process.env.QUEUE_PREFIX;
    redis?.kill("SIGTERM");
  });

  beforeEach(async () => {
    await resetDb();
    setEnv({ CONVERSION_QUEUE: undefined });
  });

  it("큐에 넣은 작업을 워커가 꺼내 DONE으로 만든다", async () => {
    expect(queueMode()).toBe("bullmq");
    const job = await makeJob("hwp/sample.hwpx", { enqueue: true });
    const done = await waitForFinish(job.id);
    expect(done.status).toBe("DONE");
    expect(done.outputAsset?.kind).toBe("PDF");
  }, 90_000);

  it("실패한 작업도 큐를 막지 않고 다음 작업이 처리된다", async () => {
    const bad = await makeJob("hwp/corrupt.hwp", { enqueue: true });
    const good = await makeJob("hwp/sample.hwp", { enqueue: true });
    expect((await waitForFinish(bad.id)).status).toBe("FAILED");
    expect((await waitForFinish(good.id)).status).toBe("DONE");
  }, 90_000);
});
