import { requireApiUser, route } from "@/server/api";
import { fileResponse, getOwnedAsset, readAsset } from "@/server/assets";

type Ctx = RouteContext<"/api/assets/[id]">;

/** 자산 내용 (소유자만). `?download=1`이면 첨부로 내려받는다. 문서의 이미지 src로도 쓰인다. */
export const GET = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const asset = await getOwnedAsset(user.id, id);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return fileResponse(await readAsset(asset), { filename: asset.filename, mime: asset.mime, download });
});
