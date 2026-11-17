// 자체 제작 fixture (2/2): HWP(rhwp로 HWPX→HWP), 텍스트 PDF, 스캔 PDF. make-fixtures.py를 먼저 실행한다.
// 사용법 (저장소 루트에서): node tests/fixtures/make-fixtures.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = import.meta.dirname;
const require = createRequire(import.meta.url);

async function makeHwp() {
  const pkg = path.dirname(require.resolve("@rhwp/core/package.json"));
  const { default: init, HwpDocument } = await import(path.join(pkg, "rhwp.js"));
  globalThis.measureTextWidth = (_font, text) => text.length * 8;
  await init({ module_or_path: fs.readFileSync(path.join(pkg, "rhwp_bg.wasm")) });
  const doc = new HwpDocument(new Uint8Array(fs.readFileSync(path.join(ROOT, "hwp/sample.hwpx"))));
  fs.writeFileSync(path.join(ROOT, "hwp/sample.hwp"), Buffer.from(doc.exportHwp()));
}

const PDF_HTML = `<!doctype html><html lang="ko"><meta charset="utf-8"><style>
body{font-family:"Noto Sans CJK KR","NanumGothic",sans-serif;font-size:11pt;margin:20mm}
h1{font-size:22pt}h2{font-size:16pt}table{border-collapse:collapse}td,th{border:1px solid #000;padding:4px 14px}
</style><body>
<h1>PDF 가져오기 샘플</h1>
<p>이 문서는 가져오기 테스트용으로 직접 만든 PDF입니다. 본문 문단은 여러 줄에 걸쳐 이어지도록 조금 길게 적습니다. 줄이 바뀌어도 하나의 문단으로 합쳐져야 합니다.</p>
<h2>측정 결과</h2>
<p>아래 표는 시료별 길이를 정리한 것이다.</p>
<table><tr><th>시료</th><th>길이</th><th>무게</th></tr><tr><td>A</td><td>10 mm</td><td>2.5 g</td></tr><tr><td>B</td><td>12 mm</td><td>3.1 g</td></tr></table>
<p>표 다음 문단입니다.</p>
<p><img src="data:image/png;base64,PNG_B64" width="160" height="96"></p>
<h2>결론</h2>
<p>마지막 문단입니다.</p>
</body></html>`;

async function makePdfs() {
  const png = fs.readFileSync(path.join(ROOT, "import/pixel.png")).toString("base64");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(PDF_HTML.replace("PNG_B64", png));
  await page.pdf({ path: path.join(ROOT, "import/sample.pdf"), format: "A4" });
  // 스캔 PDF: 글자를 그림(스크린샷)으로만 담은 쪽
  await page.setViewportSize({ width: 600, height: 300 });
  await page.setContent(`<body style="font-size:28px;margin:30px">스캔한 문서처럼 글자가 그림으로만 들어 있습니다.</body>`);
  const shot = (await page.screenshot()).toString("base64");
  await page.setContent(`<body style="margin:0"><img style="width:100%" src="data:image/png;base64,${shot}"></body>`);
  await page.pdf({ path: path.join(ROOT, "import/scanned.pdf"), format: "A4" });
  await browser.close();
}

(async () => {
  await makeHwp();
  await makePdfs();
  console.log("ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
