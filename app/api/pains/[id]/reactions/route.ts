import { json, requireApiUser, route } from "@/server/api";
import { PAIN_RATE_LIMITS, toggleReaction } from "@/server/pains";
import { rateLimit } from "@/server/rate-limit";

type Ctx = RouteContext<"/api/pains/[id]/reactions">;

/** "나도 겪었어요" 토글: 누르지 않았으면 추가, 눌렀으면 취소. */
export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  await rateLimit(`pains:reaction:${user.id}`, PAIN_RATE_LIMITS.reaction);
  const { id } = await ctx.params;
  return json(await toggleReaction(user.id, id));
});
