import { suggestLatex } from "@/lib/ai/assist";
import { getAiClient } from "@/lib/ai/client";
import { aiRateLimit, consumeDailyQuota } from "@/lib/ai/quota";
import { latexRequestSchema } from "@/lib/validation/ai";
import { json, parseBody, requireApiUser, route } from "@/server/api";

/** POST /api/ai/latex — 자연어 → LaTeX, 이미지 → LaTeX (SPEC 7.3 c) */
export const POST = route(async (req: Request) => {
  const user = await requireApiUser();
  const input = await parseBody(req, latexRequestSchema);
  await aiRateLimit(user.id);
  const client = getAiClient();
  await consumeDailyQuota(user.id, "latex");
  return json(await suggestLatex(client, input, req.signal));
});
