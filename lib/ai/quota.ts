import "server-only";
import { prisma } from "@/lib/db";
import { messages as t } from "@/lib/messages";
import { ApiError } from "@/server/api";
import { rateLimit } from "@/server/rate-limit";

export type AiUsageKind = "chat" | "latex" | "format" | "chart";

const DEFAULT_DAILY_LIMIT = 100;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 사용자별 일일 요청 한도 (환경변수 AI_DAILY_LIMIT_PER_USER, SPEC 7.4 비용 보호) */
export function dailyLimit() {
  const n = Number(process.env.AI_DAILY_LIMIT_PER_USER);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_LIMIT;
}

/** 한국 시간 기준 오늘 0시 */
export function startOfToday(now = new Date()) {
  return new Date(Math.floor((now.getTime() + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS);
}

/** 짧은 시간에 몰리는 요청을 막는다 (SPEC 9장: AI 엔드포인트 rate limit). */
export async function aiRateLimit(userId: string) {
  await rateLimit(`ai:${userId}`, { limit: 20, windowMs: 60_000 });
}

/**
 * 오늘 사용량을 1 올린다. 한도를 넘으면 기록을 되돌리고 429.
 * 먼저 기록한 뒤 세기 때문에 동시 요청이 몰려도 한도를 넘겨 통과하지 못한다.
 */
export async function consumeDailyQuota(userId: string, kind: AiUsageKind) {
  const limit = dailyLimit();
  const row = await prisma.aiUsage.create({ data: { userId, kind } });
  const used = await prisma.aiUsage.count({ where: { userId, createdAt: { gte: startOfToday() } } });
  if (used > limit) {
    await prisma.aiUsage.delete({ where: { id: row.id } });
    throw new ApiError("RATE_LIMITED", t.ai.errors.dailyLimit.replace("{n}", String(limit)), { reason: "DAILY_LIMIT" });
  }
}
