import { createCommentSchema } from "@/lib/validation/pain";
import { json, parseBody, requireApiUser, route } from "@/server/api";
import { addComment, PAIN_RATE_LIMITS } from "@/server/pains";
import { rateLimit } from "@/server/rate-limit";

type Ctx = RouteContext<"/api/pains/[id]/comments">;

export const POST = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  await rateLimit(`pains:comment:${user.id}`, PAIN_RATE_LIMITS.comment);
  const { id } = await ctx.params;
  const { body } = await parseBody(req, createCommentSchema);
  return json({ comment: await addComment(user.id, id, body) }, { status: 201 });
});
