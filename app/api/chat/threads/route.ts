import type { ChatThreadSummary } from "@/lib/ai/shared";
import { prisma } from "@/lib/db";
import { json, requireApiUser, route } from "@/server/api";

/** GET /api/chat/threads — 내 최근 대화 목록 (스레드 이어가기용) */
export const GET = route(async () => {
  const user = await requireApiUser();
  const rows = await prisma.chatThread.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, title: true, createdAt: true },
  });
  const threads: ChatThreadSummary[] = rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt.toISOString() }));
  return json({ threads });
});
