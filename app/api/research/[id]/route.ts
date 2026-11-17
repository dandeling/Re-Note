import { json, notFound, route } from "@/server/api";
import { getPublicResearch } from "@/server/research";

type Ctx = RouteContext<"/api/research/[id]">;

/** 공개된 연구 상세. 비로그인도 볼 수 있다. 작성자 정보는 포함하지 않는다. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const research = await getPublicResearch(id);
  if (!research) notFound();
  return json({ research });
});
