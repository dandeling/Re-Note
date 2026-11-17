import { suggestFormatRules } from "@/lib/ai/assist";
import { getAiClient } from "@/lib/ai/client";
import { aiRateLimit, consumeDailyQuota } from "@/lib/ai/quota";
import { validateRulesPatch } from "@/lib/format/patch";
import { formatRequestSchema } from "@/lib/validation/ai";
import { json, parseBody, requireApiUser, route } from "@/server/api";

/**
 * POST /api/ai/format — 자유 텍스트 → 서식 rulesJson 후보 (SPEC 7.3 d).
 * 결과는 formatRulesSchema로 검증한 항목만 담은 규칙 조각이며, 사용자가 폼에서 확인한 뒤에 적용한다.
 */
export const POST = route(async (req: Request) => {
  const user = await requireApiUser();
  const { text } = await parseBody(req, formatRequestSchema);
  await aiRateLimit(user.id);
  const client = getAiClient();
  await consumeDailyQuota(user.id, "format");
  return json(await suggestFormatRules(client, text, validateRulesPatch, req.signal));
});
