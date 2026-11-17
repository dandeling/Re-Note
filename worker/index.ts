// 변환 워커: BullMQ 큐("conversion")의 작업을 꺼내 엔진 체인으로 처리한다 (SPEC 7.3 a, docs/hwp-spike.md).
// 실행: pnpm worker  (= tsx worker/index.ts). 필요한 환경변수: DATABASE_URL, REDIS_URL, S3_* (web과 같은 스토리지)
import "dotenv/config";
import { Worker } from "bullmq";
import { log } from "@/lib/log";
import { failStaleJobs, processJob } from "@/server/jobs/process";
import { QUEUE_NAME, queuePrefix, redisConnection } from "@/server/jobs/queue";

export function startWorker() {
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 2);
  const worker = new Worker<{ jobId: string }>(QUEUE_NAME, async (job) => processJob(job.data.jobId), {
    connection: redisConnection(),
    prefix: queuePrefix(),
    concurrency,
  });
  // Redis가 내려가 있으면 같은 오류가 초당 수백 번 난다. 5초에 한 번만 기록한다.
  let lastErrorLog = 0;
  worker.on("error", (err) => {
    if (Date.now() - lastErrorLog < 5000) return;
    lastErrorLog = Date.now();
    log.error("worker.error", { error: String(err).slice(0, 500) });
  });
  worker.on("failed", (job, err) => log.error("worker.job_failed", { jobId: job?.data.jobId, error: String(err) }));
  // 워커가 죽어 RUNNING으로 남은 작업을 주기적으로 FAILED 처리한다.
  const sweep = setInterval(() => {
    failStaleJobs().catch((err) => log.error("worker.sweep_failed", { error: String(err) }));
  }, 60_000);
  sweep.unref();
  log.info("worker.started", { queue: QUEUE_NAME, prefix: queuePrefix(), concurrency });
  return {
    worker,
    async stop() {
      clearInterval(sweep);
      await worker.close();
    },
  };
}

// 직접 실행했을 때만 기동한다 (테스트는 startWorker를 불러 쓴다).
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const { stop } = startWorker();
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      log.info("worker.stopping", { signal });
      stop().finally(() => process.exit(0));
    });
  }
}
