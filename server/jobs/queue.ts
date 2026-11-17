import { Queue, type ConnectionOptions } from "bullmq";
import { log } from "@/lib/log";

/**
 * 변환 작업 큐 (BullMQ + Redis). 페이로드는 `{ jobId }`뿐이고 상태는 DB의 ConversionJob이 가진다.
 *
 * 모드 (CONVERSION_QUEUE 환경변수):
 *   - "bullmq": Redis 큐에 넣고 워커 컨테이너(worker/index.ts)가 처리한다. REDIS_URL이 있으면 기본값.
 *   - "inline": 큐 없이 웹 프로세스가 응답 뒤에 바로 처리한다. REDIS_URL이 없을 때의 기본값 (개발·테스트용).
 */
export const QUEUE_NAME = "conversion";

export function queueMode(): "bullmq" | "inline" {
  const mode = process.env.CONVERSION_QUEUE;
  if (mode === "bullmq" || mode === "inline") return mode;
  return process.env.REDIS_URL ? "bullmq" : "inline";
}

export function queuePrefix() {
  return process.env.QUEUE_PREFIX || "rm";
}

export function redisConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL || "redis://localhost:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

let queue: { key: string; queue: Queue } | null = null;

function getQueue() {
  const key = `${process.env.REDIS_URL}|${queuePrefix()}`;
  if (queue?.key !== key) {
    void queue?.queue.close().catch(() => undefined);
    queue = { key, queue: new Queue(QUEUE_NAME, { connection: redisConnection(), prefix: queuePrefix() }) };
  }
  return queue.queue;
}

/** 테스트·종료 시 연결 정리 */
export async function closeQueue() {
  await queue?.queue.close().catch(() => undefined);
  queue = null;
}

/** 작업을 처리 대기열에 넣는다. */
export async function enqueueJob(jobId: string) {
  if (queueMode() === "bullmq") {
    await getQueue().add(
      "convert",
      { jobId },
      { jobId, attempts: 1, removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 24 * 3600 } },
    );
    return;
  }
  // inline: 순환 import를 피하려고 여기서 불러온다.
  const { processJob } = await import("@/server/jobs/process");
  setImmediate(() => {
    processJob(jobId).catch((err) => log.error("conversion.inline_failed", { jobId, error: String(err) }));
  });
}
