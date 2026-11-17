import { notFound, route } from "@/server/api";
import { readFontFile } from "@/server/format-fonts";

type Ctx = RouteContext<"/api/format-fonts/[pkg]/[file]">;

/** 글꼴 파일 (허용 목록의 패키지·파일만) */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { pkg, file } = await ctx.params;
  const font = await readFontFile(pkg, file);
  if (!font) notFound();
  return new Response(new Uint8Array(font.data), {
    headers: { "content-type": font.contentType, "cache-control": "public, max-age=31536000, immutable" },
  });
});
