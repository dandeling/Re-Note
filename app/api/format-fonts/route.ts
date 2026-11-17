import { FONT_IDS } from "@/lib/format/fonts";
import { route } from "@/server/api";
import { fontFaceCss, FORMAT_FONTS_URL } from "@/server/format-fonts";

/** 서식에서 고를 수 있는 글꼴의 @font-face CSS (공개 글꼴이라 로그인 없이 제공) */
export const GET = route(async () => {
  return new Response(await fontFaceCss(FONT_IDS, FORMAT_FONTS_URL), {
    headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=86400" },
  });
});
