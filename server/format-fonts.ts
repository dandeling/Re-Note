import { readFile } from "node:fs/promises";
import path from "node:path";
import { FONT_IDS, FONTS, type FontId } from "@/lib/format/fonts";

/**
 * 서식 글꼴 파일 (OFL 글꼴, @fontsource 패키지).
 * 에디터 화면(/api/format-fonts)과 PDF 내보내기가 같은 @font-face·같은 파일을 쓴다.
 * 번들러에 넣지 않고 디스크에서 읽는다: 한글 글꼴은 유니코드 범위별로 수천 개 파일로 나뉘어 있어
 * 번들에 넣으면 빌드가 크게 느려지고, 브라우저는 필요한 조각만 내려받는다.
 */
const WEIGHTS = [400, 700] as const;
// 번들 추적(Vercel 함수에 넣을 파일)은 이 동적 경로로 @fontsource 전체(수만 개, 170MB 남짓)를 끌어들이므로 끄고,
// 실제로 쓰는 400·700 굵기의 CSS·woff2만 next.config.ts의 outputFileTracingIncludes로 넣는다.
const root = () => path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules", "@fontsource");
const PACKAGES = new Set<string>(FONT_IDS.map((id) => FONTS[id].pkg));
const FILE_PATTERN = /^[a-z0-9-]+\.(woff2|woff)$/;

const cssCache = new Map<string, Promise<string>>();

async function loadCss(font: FontId): Promise<string> {
  const pkg = FONTS[font].pkg;
  const parts = await Promise.all(WEIGHTS.map((w) => readFile(path.join(/* turbopackIgnore: true */ root(), pkg, `${w}.css`), "utf8")));
  // url(./files/<file>) → url(<base>/<pkg>/<file>). <base>는 fontFaceCss에서 채운다.
  return parts.join("\n").replace(/url\(\.\/files\/([^)]+)\)/g, `url(__BASE__/${pkg}/$1)`);
}

/** 주어진 글꼴들의 @font-face CSS. 글꼴 파일 주소는 `${urlBase}/<패키지>/<파일>`. */
export async function fontFaceCss(fonts: readonly FontId[], urlBase: string): Promise<string> {
  const parts = await Promise.all(
    fonts.map((font) => {
      let css = cssCache.get(font);
      if (!css) {
        css = loadCss(font);
        cssCache.set(font, css);
        css.catch(() => cssCache.delete(font));
      }
      return css;
    }),
  );
  return parts.join("\n").replaceAll("__BASE__", urlBase);
}

/** 글꼴 파일을 읽는다. 허용한 패키지·파일 이름이 아니면 null (경로 조작 방지). */
export async function readFontFile(pkg: string, file: string): Promise<{ data: Buffer; contentType: string } | null> {
  if (!PACKAGES.has(pkg) || !FILE_PATTERN.test(file)) return null;
  try {
    const data = await readFile(path.join(/* turbopackIgnore: true */ root(), pkg, "files", file));
    return { data, contentType: file.endsWith(".woff2") ? "font/woff2" : "font/woff" };
  } catch {
    return null;
  }
}

export const FORMAT_FONTS_URL = "/api/format-fonts";
