import { createResearchSchema } from "@/lib/validation/research";
import { json, parseBody, requireApiUser, route } from "@/server/api";
import { createResearch } from "@/server/research";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

/** 본인 프로젝트를 연구로 공개한다 (SPEC 7.2). 남의 프로젝트는 404. */
export const POST = route(async (req) => {
  const user = await requireApiUser();
  await rateLimit(`write:${user.id}`, RATE_LIMITS.write());
  const input = await parseBody(req, createResearchSchema);
  return json({ research: await createResearch(user.id, input) }, { status: 201 });
});
