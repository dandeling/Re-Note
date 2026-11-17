import { getOwnedDatasetColumns, suggestChart } from "@/lib/ai/assist";
import { getAiClient } from "@/lib/ai/client";
import { aiRateLimit, consumeDailyQuota } from "@/lib/ai/quota";
import { chartSuggestRequestSchema } from "@/lib/validation/ai";
import { json, parseBody, requireApiUser, route } from "@/server/api";

/**
 * POST /api/ai/chart-suggest — Dataset의 열 정보만 보고 그래프 유형·축 구성을 제안 (SPEC 7.3 e).
 * AI는 수치를 만들지 않는다. 실제 그리기는 클라이언트가 원본 데이터로 수행한다.
 */
export const POST = route(async (req: Request) => {
  const user = await requireApiUser();
  const { datasetId } = await parseBody(req, chartSuggestRequestSchema);
  await aiRateLimit(user.id);
  const client = getAiClient();
  const dataset = await getOwnedDatasetColumns(user.id, datasetId);
  await consumeDailyQuota(user.id, "chart");
  return json({ datasetId: dataset.id, suggestions: await suggestChart(client, dataset, req.signal) });
});
