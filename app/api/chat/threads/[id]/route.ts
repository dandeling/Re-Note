import { getOwnedThread, toMessageView } from "@/lib/ai/chat";
import { prisma } from "@/lib/db";
import { json, requireApiUser, route } from "@/server/api";

type Ctx = RouteContext<"/api/chat/threads/[id]">;

/** GET /api/chat/threads/:id — 본인 스레드의 메시지. 남의 스레드는 404. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const thread = await getOwnedThread(user.id, id);
  const rows = await prisma.chatMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "asc" }, take: 200 });
  return json({
    thread: { id: thread.id, title: thread.title, createdAt: thread.createdAt.toISOString() },
    messages: rows.map(toMessageView),
  });
});
