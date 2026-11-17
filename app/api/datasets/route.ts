import { createDatasetSchema, listDatasetsSchema } from "@/lib/validation/dataset";
import { json, parseBody, parseQuery, requireApiUser, route } from "@/server/api";
import { createDataset, listDatasets, toSummary } from "@/server/datasets";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

/** CSV 자산 → 파싱 → Dataset 저장 */
export const POST = route(async (req) => {
  const user = await requireApiUser();
  await rateLimit(`dataset:${user.id}`, RATE_LIMITS.upload());
  const input = await parseBody(req, createDatasetSchema);
  const { dataset, encoding, warnings } = await createDataset(user.id, input);
  return json({ dataset: toSummary(dataset), encoding, warnings }, { status: 201 });
});

/** 프로젝트의 데이터셋 목록 (`?projectId=`) */
export const GET = route(async (req) => {
  const user = await requireApiUser();
  const { projectId } = parseQuery(req, listDatasetsSchema);
  return json({ datasets: await listDatasets(user.id, projectId) });
});
