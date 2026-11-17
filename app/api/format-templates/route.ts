import { listFormatTemplatesQuerySchema, saveFormatTemplateSchema } from "@/lib/validation/format";
import { getOwnedDocument } from "@/server/access";
import { json, parseBody, parseQuery, requireApiUser, route } from "@/server/api";
import { listFormatTemplates, saveFormatTemplate } from "@/server/format-templates";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

/** 프리셋 + 내 템플릿. `?docId=`를 주면 그 문서(내 문서만)에 적용된 템플릿 id도 돌려준다. */
export const GET = route(async (req) => {
  const user = await requireApiUser();
  const { docId } = parseQuery(req, listFormatTemplatesQuerySchema);
  const documentTemplateId = docId ? (await getOwnedDocument(user.id, docId)).formatTemplateId : undefined;
  return json({ ...(await listFormatTemplates(user.id)), documentTemplateId });
});

/** 내 템플릿 저장(id 없음) 또는 수정(id 있음, 소유자만) */
export const POST = route(async (req) => {
  const user = await requireApiUser();
  await rateLimit(`write:${user.id}`, RATE_LIMITS.write());
  const input = await parseBody(req, saveFormatTemplateSchema);
  const { created, template } = await saveFormatTemplate(user.id, input);
  return json({ template }, { status: created ? 201 : 200 });
});
