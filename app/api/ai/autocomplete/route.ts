import {
  autocompleteAvailability,
  autocompleteRateLimit,
  getAutocompleteClient,
  suggestCompletion,
} from "@/lib/ai/autocomplete";
import { autocompleteRequestSchema } from "@/lib/validation/autocomplete";
import { getOwnedDocument } from "@/server/access";
import { json, parseBody, requireApiUser, route } from "@/server/api";

/** GET /api/ai/autocomplete — 자동완성을 쓸 수 있는지 (AI 호출·한도 소모 없음) */
export const GET = route(async () => {
  await requireApiUser();
  return json(autocompleteAvailability());
});

/** POST /api/ai/autocomplete — 커서 뒤에 이어질 말 한 문장 이내 제안 */
export const POST = route(async (req: Request) => {
  const user = await requireApiUser();
  const input = await parseBody(req, autocompleteRequestSchema);
  await getOwnedDocument(user.id, input.documentId);
  // 키가 없으면 한도를 세기 전에 503으로 끝낸다.
  const client = getAutocompleteClient();
  await autocompleteRateLimit(user.id);
  const completion = await suggestCompletion(
    client,
    { before: input.before, section: input.section, title: input.title },
    req.signal,
  );
  return json({ completion });
});
