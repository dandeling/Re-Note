import type { DocContent } from "@/lib/editor/content";
import { exportDocumentSchema } from "@/lib/validation/format";
import { getOwnedDocument } from "@/server/access";
import { json, parseBody, requireApiUser, route } from "@/server/api";
import { assetView, createAssetFromBytes } from "@/server/assets";
import { assertPdfExport, contentDisposition, exportDocument } from "@/server/export";
import { rulesForDocument } from "@/server/format-templates";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

type Ctx = RouteContext<"/api/docs/[id]/export">;

/**
 * 문서 내보내기: PDF(서식 반영) / DOCX / Markdown. 남의 문서는 404.
 * `saveAsAsset: true`(PDF만)면 파일 대신 내 PDF 자산을 만들어 `{ asset }`을 돌려준다(연구 공개의 결과보고서, SPEC 7.2).
 * PDF는 Chromium을 띄우므로 사용자당 rate limit을 건다.
 * PDF 내보내기를 끈 배포(Vercel, lib/features.ts)에서는 PDF 요청(saveAsAsset 포함)이 501이다. DOCX·Markdown은 그대로.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  await rateLimit(`export:${user.id}`, RATE_LIMITS.export());
  const { id } = await ctx.params;
  const { format, saveAsAsset } = await parseBody(req, exportDocumentSchema);
  if (format === "pdf") assertPdfExport();
  const doc = await getOwnedDocument(user.id, id);
  const rules = await rulesForDocument(doc);
  const file = await exportDocument(format, { title: doc.title, contentJson: doc.contentJson as DocContent }, rules);
  if (saveAsAsset) {
    const asset = await createAssetFromBytes({
      ownerId: user.id,
      projectId: doc.projectId,
      filename: file.filename,
      bytes: file.body,
      allowed: ["pdf"],
    });
    return json({ asset: assetView(asset) }, { status: 201 });
  }
  return new Response(new Uint8Array(file.body), {
    headers: {
      "content-type": file.contentType,
      "content-disposition": contentDisposition(file.filename),
      "cache-control": "no-store",
    },
  });
});
