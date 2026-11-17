import { updateDocumentSchema } from "@/lib/validation/document";
import { getOwnedDocument } from "@/server/access";
import { json, parseBody, requireApiUser, route } from "@/server/api";
import { trashDocument, updateDocument } from "@/server/documents";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

type Ctx = RouteContext<"/api/docs/[id]">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  return json({ document: await getOwnedDocument(user.id, id) });
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  await rateLimit(`doc-save:${user.id}`, RATE_LIMITS.write());
  const { id } = await ctx.params;
  const input = await parseBody(req, updateDocumentSchema);
  const document = await updateDocument(user.id, id, input);
  // 저장 응답에는 내용을 다시 싣지 않는다 (큰 문서의 왕복 비용 절감).
  return json({
    document: { id: document.id, title: document.title, version: document.version, updatedAt: document.updatedAt },
  });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  await rateLimit(`write:${user.id}`, RATE_LIMITS.write());
  const { id } = await ctx.params;
  await trashDocument(user.id, id);
  return json({ ok: true });
});
