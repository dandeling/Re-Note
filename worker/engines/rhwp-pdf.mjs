// 변환 엔진: rhwp(WASM)를 헤드리스 Chromium 안에서 실행해 HWP/HWPX → PDF로 인쇄한다.
// 사용법: node worker/engines/rhwp-pdf.mjs <입력.hwp|.hwpx> <출력.pdf>
// 별도 프로세스로 실행된다(lib/conversion/engines.ts). 실패하면 0이 아닌 코드로 끝난다.
// 외부 네트워크는 쓰지 않는다: 가짜 호스트(rhwp.local)로 가는 요청만 로컬 파일로 응답하고 나머지는 차단한다.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: rhwp-pdf.mjs <input> <output.pdf>");
  process.exit(2);
}

const require = createRequire(import.meta.url);
const pkg = path.dirname(require.resolve("@rhwp/core/package.json"));
const ORIGIN = "http://rhwp.local";

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><body></body>' });
    }
    const file = path.join(pkg, path.basename(url.pathname));
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({
      contentType: url.pathname.endsWith(".wasm") ? "application/wasm" : "text/javascript",
      body: fs.readFileSync(file),
    });
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  const pages = await page.evaluate(async (b64) => {
    const { default: init, HwpDocument } = await import("/rhwp.js");
    let ctx = null;
    let lastFont = "";
    globalThis.measureTextWidth = (font, text) => {
      if (!ctx) ctx = document.createElement("canvas").getContext("2d");
      if (font !== lastFont) {
        ctx.font = font;
        lastFont = font;
      }
      return ctx.measureText(text).width;
    };
    await init({ module_or_path: "/rhwp_bg.wasm" });
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const doc = new HwpDocument(bytes);
    const count = doc.pageCount();
    let html = "";
    let size = null;
    for (let i = 0; i < count; i++) {
      const svg = doc.renderPageSvg(i);
      if (!size) {
        const m = /width="([\d.]+)"[^>]*height="([\d.]+)"/.exec(svg);
        size = m ? [m[1], m[2]] : [794, 1123];
      }
      html += svg;
    }
    if (!size) size = [794, 1123];
    document.head.insertAdjacentHTML(
      "beforeend",
      `<style>@page{size:${size[0]}px ${size[1]}px;margin:0}body{margin:0}svg{display:block;break-after:page}</style>`,
    );
    document.body.innerHTML = html;
    return count;
  }, fs.readFileSync(input).toString("base64"));
  if (!pages) throw new Error("document has no pages");
  await page.pdf({ path: output, preferCSSPageSize: true, printBackground: true });
  console.log(JSON.stringify({ pages }));
} catch (err) {
  console.error(String(err).slice(0, 500));
  process.exitCode = 1;
} finally {
  await browser.close();
}
