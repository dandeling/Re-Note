import { updatePainSchema } from "@/lib/validation/pain";
import { json, parseBody, requireApiUser, route } from "@/server/api";
import { deletePain, getPain, PAIN_RATE_LIMITS, updatePain } from "@/server/pains";
import { rateLimit } from "@/server/rate-limit";
import { getCurrentUser } from "@/server/session";

type Ctx = RouteContext<"/api/pains/[id]">;

/** 상세는 비로그인도 읽을 수 있다 (SPEC 7.1). 댓글은 없다(docs/decisions.md pains-9). */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const viewer = await getCurrentUser();
  return json({ pain: await getPain(id, viewer?.id ?? null) });
});

/** 작성자만 수정할 수 있다. 남의 글은 403. 해결됨 처리도 여기서 한다. */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  await rateLimit(`pains:write:${user.id}`, PAIN_RATE_LIMITS.write);
  const { id } = await ctx.params;
  const input = await parseBody(req, updatePainSchema);
  return json({ pain: await updatePain(user.id, id, input) });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  await deletePain(user.id, id);
  return json({ ok: true });
});
