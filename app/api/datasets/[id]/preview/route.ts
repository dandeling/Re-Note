import { previewDatasetSchema } from "@/lib/validation/dataset";
import { json, parseQuery, requireApiUser, route } from "@/server/api";
import { previewDataset } from "@/server/datasets";

type Ctx = RouteContext<"/api/datasets/[id]/preview">;

/** 데이터셋의 열 정보와 앞부분 행 (`?limit=`, 기본 50). 표·그래프를 만들 때는 전체 행을 요청한다. */
export const GET = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const { limit } = parseQuery(req, previewDatasetSchema);
  return json(await previewDataset(user.id, id, limit));
});
