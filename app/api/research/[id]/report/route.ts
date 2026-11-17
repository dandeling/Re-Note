import { prisma } from "@/lib/db";
import { notFound, route } from "@/server/api";
import { fileResponse, readAsset } from "@/server/assets";

type Ctx = RouteContext<"/api/research/[id]/report">;

/**
 * 공개된 연구의 결과보고서 PDF (SPEC 7.2). 연구가 공개된 것이므로 비로그인도 받을 수 있다.
 * 자산 ID가 아니라 연구 ID로만 접근하게 해, 공개 연구에 연결된 PDF 외의 자산은 노출되지 않는다.
 */
export const GET = route<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const research = await prisma.research.findUnique({
    where: { id },
    select: { reportAsset: { select: { storageKey: true, filename: true, mime: true, kind: true, deletedAt: true } } },
  });
  const asset = research?.reportAsset;
  if (!asset || asset.deletedAt || asset.kind !== "PDF") notFound();
  const download = new URL(req.url).searchParams.get("download") === "1";
  return fileResponse(await readAsset(asset), { filename: asset.filename, mime: "application/pdf", download });
});
