import { createPainSchema, listPainsQuerySchema } from "@/lib/validation/pain";
import { json, parseBody, parseQuery, requireApiUser, route } from "@/server/api";
import { createPain, listPains, PAIN_RATE_LIMITS } from "@/server/pains";
import { rateLimit } from "@/server/rate-limit";
import { getCurrentUser } from "@/server/session";

/** 목록은 비로그인도 읽을 수 있다 (SPEC 7.1). */
export const GET = route(async (req) => {
  const query = parseQuery(req, listPainsQuerySchema);
  const viewer = await getCurrentUser();
  return json(await listPains({ ...query, viewerId: viewer?.id ?? null }));
});

export const POST = route(async (req) => {
  const user = await requireApiUser();
  await rateLimit(`pains:write:${user.id}`, PAIN_RATE_LIMITS.write);
  const input = await parseBody(req, createPainSchema);
  return json({ pain: await createPain(user.id, input) }, { status: 201 });
});
