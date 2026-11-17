/* 담당 C 테스트: 프로젝트·문서·에디터(자동 저장, 충돌, 초안, 스냅샷, 캡션·상호 참조, 수식, 서식, 검사, 내보내기, 휴지통, 접근 제어)
   + 2차: 여러 블록에 걸친 선택·편집, 한글 조합 입력, 문단 안 줄바꿈, DOCX 내보내기, 단순해진 UI(삽입 메뉴·접힌 패널·프로젝트 탭).
   + 3차: 수식 입력 창(쉬운 표기 easyToLatex, 틀 버튼, 미리보기, 말로 만들기), Markdown 가져오기의 그림.
   실행: node tests/c.spec.cjs (포트 4103). 외부 요청은 막고 KaTeX·PapaParse는 로컬 node_modules에서 준다. */
const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const zlib = require("node:zlib");

const PORT = 4103;
const BASE = `http://localhost:${PORT}/dev.html`;
const ROOT = path.join(__dirname, "..");
const NM = path.join(ROOT, "..", "node_modules");
const MY_FILES = /mod-editor\.js/;

let passed = 0, failed = 0, skipped = 0;
const failures = [];
async function test(name, fn) {
  try { const r = await fn(); if (r === "skip") { skipped++; console.log("  skip " + name); } else { passed++; console.log("  ok  " + name); } }
  catch (e) { failed++; failures.push(name); console.log("  FAIL " + name + "\n       " + String((e && e.stack) || e).split("\n").slice(0, 6).join("\n       ")); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 무압축 zip 읽기(검증용): 중앙 디렉터리 → 이름·CRC·크기, 로컬 헤더와 대조 */
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert(eocd >= 0, "EOCD 없음");
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const files = {};
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    assert(buf.readUInt32LE(p) === 0x02014b50, "중앙 디렉터리 서명");
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    assert(buf.readUInt32LE(off) === 0x04034b50, "로컬 헤더 서명: " + name);
    assert(buf.readUInt32LE(off + 14) === crc, "로컬/중앙 CRC 일치: " + name);
    const dataStart = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.slice(dataStart, dataStart + size);
    assert(method === 0 && size === usize, "무압축: " + name);
    assert(zlib.crc32(data) === crc, "CRC32 맞음: " + name);
    files[name] = data;
    p += 46 + nlen + elen + clen;
  }
  return files;
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, "dev-server.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((res, rej) => { server.stdout.once("data", res); server.once("error", rej); setTimeout(res, 3000); });
  const browser = await chromium.launch();
  const errors = [];

  async function setupContext(viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (route) => {
      const u = route.request().url();
      if (u.includes("katex.min.js")) return route.fulfill({ path: path.join(NM, "katex/dist/katex.min.js"), contentType: "text/javascript" });
      if (u.includes("papaparse.min.js")) return route.fulfill({ path: path.join(NM, "papaparse/papaparse.min.js"), contentType: "text/javascript" });
      return route.abort();
    });
    return ctx;
  }
  async function newPage(ctx, query = "") {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { const s = String(e.stack || e); if (MY_FILES.test(s)) errors.push(s); });
    page.on("console", (m) => { if (m.type() === "error" && MY_FILES.test(m.text() + JSON.stringify(m.location()))) errors.push(m.text()); });
    await page.goto(BASE + query);
    await page.waitForFunction(() => window.RN && RN.docs && RN.caps && RN.current && RN.current.name);
    await page.evaluate(() => RN.ready);
    return page;
  }
  const go = (page, name, params) => page.evaluate(([n, p]) => RN.go(n, p), [name, params || {}]);
  const openEditor = async (page, projectId, docId) => {
    await go(page, "editor", { projectId, docId });
    await page.waitForSelector("#ed-blocks .rn-blk");
    await page.waitForFunction(() => !!RN.editor);
  };
  const waitSaved = (page) => page.waitForFunction(() => /^저장됨/.test(document.querySelector("#ed-status").textContent), null, { timeout: 8000 });
  const firstPara = (page) => page.locator("#ed-blocks > .rn-blk-paragraph").first();
  const lastPara = (page) => page.locator("#ed-blocks > .rn-blk-paragraph").last();
  const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("renote-mock-db") || "{}"));
  const docPath = (uid, id) => `data/users/${uid}/docs/items/${id}`;
  const blocks = (page) => page.evaluate(() => RN.editor.getDoc().content.blocks);
  const textOf = (b) => (b.content || []).map((n) => (n.t === "text" ? n.text : n.t === "br" ? "⏎" : "¤")).join("");
  /** 삽입 메뉴 항목 누르기 */
  const insertMenu = async (page, id) => { await page.click("#tb-insert"); await page.click("#" + id); };
  /** 오른쪽 패널 열기(이미 열려 있으면 그대로) */
  const openPanel = async (page, id) => {
    if ((await page.getAttribute("#edtab-" + id, "aria-expanded")) !== "true") await page.click("#edtab-" + id);
    await page.waitForSelector("#edpanel-" + id + ":not([hidden])");
  };
  /** 본문 안 글자 위치로 DOM 선택 만들기(마우스로 끌어 고른 것과 같다) */
  const selectText = (page, from, to) => page.evaluate(([f, t]) => {
    const find = (bi, off) => {
      const el = document.querySelectorAll("#ed-blocks > .rn-blk")[bi];
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n, left = off;
      while ((n = w.nextNode())) { if (left <= n.data.length) return [n, left]; left -= n.data.length; }
      return [el, el.childNodes.length];
    };
    const [a, ao] = find(f[0], f[1]), [b, bo] = find(t[0], t[1]);
    document.getElementById("ed-blocks").focus();
    window.getSelection().setBaseAndExtent(a, ao, b, bo);
  }, [from, to]);
  /** 새 문서 하나를 만들고 블록을 채워 연다 */
  const freshDoc = async (page, projectId, content, title) => {
    const id = await page.evaluate(([pid, c, t]) => RN.docs.createDoc(pid, { title: t || "선택 시험", content: c }), [projectId, content, title]);
    await openEditor(page, projectId, id);
    return id;
  };
  const P = (id, text) => ({ id, type: "paragraph", content: text ? [{ t: "text", text }] : [] });

  const ctx = await setupContext();
  const page = await newPage(ctx);
  await page.evaluate(() => window.__mockDb.reset());
  await page.reload();
  await page.waitForFunction(() => window.RN && RN.docs);
  await page.evaluate(() => RN.ready);

  let projectId = null, docId = null;

  await test("프로젝트 목록: 새 프로젝트 버튼 → 폼 펼침 → 만들기 → 프로젝트 홈(문서 탭) → 새 문서 → 에디터", async () => {
    await go(page, "projects");
    await page.waitForSelector("#proj-new");
    assert(await page.isHidden("#proj-form"), "폼은 처음에 접혀 있음");
    assert(!(await page.$("#proj-title:visible")), "제목 입력 안 보임");
    await page.click("#proj-new");
    assert(await page.isVisible("#proj-form"), "폼 펼침");
    assert((await page.getAttribute("#proj-new", "aria-expanded")) === "true", "aria-expanded");
    await page.fill("#proj-title", "구리관 자석 낙하");
    await page.fill("#proj-desc", "렌츠 법칙 실험");
    await page.fill("#proj-field", "물리");
    await page.fill("#proj-keywords", "렌츠 법칙, 맴돌이 전류");
    await page.click("#proj-create");
    await page.waitForFunction(() => RN.current.name === "project" && document.querySelector("h1").textContent === "구리관 자석 낙하");
    projectId = await page.evaluate(() => RN.current.params.id);
    const s = await store(page);
    assert(s[`data/users/u1/projects/items/${projectId}`], "프로젝트가 개인 경로에 저장됨");
    // 탭: 문서(기본) + 섹션들 + 설정
    const tabs = await page.$$eval("#rn-view [role=tab]", (els) => els.map((e) => [e.textContent, e.getAttribute("aria-selected")]));
    assert(tabs[0][0] === "문서" && tabs[0][1] === "true" && tabs[tabs.length - 1][0] === "설정", "탭: " + JSON.stringify(tabs));
    await page.click("#proj-new-doc");
    await page.waitForFunction(() => RN.current.name === "editor" && !!RN.editor);
    docId = await page.evaluate(() => RN.editor.docId);
    assert(docId, "docId");
  });

  await test("에디터 첫 화면: 패널은 접혀 있고 도구 모음은 한 줄, 본문은 하나의 contenteditable", async () => {
    assert(await page.isHidden("#ed-side"), "오른쪽 패널 접힘");
    const r = await page.evaluate(() => {
      const tb = document.querySelector(".rn-ed-toolbar");
      const kids = [...tb.children].filter((c) => c.offsetParent !== null && !c.hidden);
      const tops = new Set(kids.map((c) => Math.round(c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2)));
      return { tops: tops.size, ce: document.querySelector("#ed-blocks").getAttribute("contenteditable"), inner: document.querySelectorAll("#ed-blocks [contenteditable=true]").length,
        panels: [...document.querySelectorAll(".rn-ed-panelbar button")].map((b) => b.textContent), statusSmall: parseFloat(getComputedStyle(document.querySelector("#ed-status")).fontSize) < 14 };
    });
    assert(r.tops === 1, "도구 모음 한 줄: " + r.tops);
    assert(r.ce === "true" && r.inner === 0, "본문 하나의 편집 영역: " + JSON.stringify(r));
    assert(JSON.stringify(r.panels.slice(0, 3)) === JSON.stringify(["서식", "내보내기", "버전 기록"]) && r.panels.includes("데이터"), "패널 버튼: " + r.panels);
    assert(r.statusSmall, "저장 상태는 작은 글자");
    assert(!(await page.$("#tb-snapshot")), "버전 저장 버튼은 도구 모음에 없음");
  });

  await test("입력 → 2초 뒤 자동 저장 표시 → 새로고침해도 유지 (시나리오 1)", async () => {
    await page.fill("#ed-title", "실험 보고서");
    const p = firstPara(page);
    await p.click();
    await page.keyboard.type("자석이 구리관을 통과하는 시간");
    await page.waitForFunction(() => /저장 대기|저장 중/.test(document.querySelector("#ed-status").textContent), null, { timeout: 2000 });
    await waitSaved(page);
    const s = await store(page);
    const d = s[docPath("u1", docId)];
    assert(d.title === "실험 보고서", "제목 저장: " + d.title);
    assert(JSON.stringify(d.content).includes("자석이 구리관을 통과하는 시간"), "본문 저장");
    assert(d.version >= 2, "version 증가");
    await page.reload();
    await page.waitForFunction(() => window.RN && RN.docs);
    await page.evaluate(() => RN.ready);
    await go(page, "project", { id: projectId });
    await page.click(`[data-doc-id="${docId}"] button.rn-link`);
    await page.waitForFunction(() => !!RN.editor);
    await page.waitForSelector("#ed-blocks .rn-slot");
    assert((await firstPara(page).textContent()) === "자석이 구리관을 통과하는 시간", "새로고침 뒤 본문");
    assert((await page.inputValue("#ed-title")) === "실험 보고서", "새로고침 뒤 제목");
  });

  await test("Enter로 새 문단, 문단 종류(select), 굵게, 실행 취소", async () => {
    const p = firstPara(page);
    await p.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("둘째 문단");
    let bl = await blocks(page);
    assert(bl.length === 2 && bl[1].type === "paragraph" && textOf(bl[1]) === "둘째 문단", "문단 2개: " + JSON.stringify(bl));
    assert((await page.inputValue("#tb-block")) === "paragraph", "select가 본문을 보여 줌");
    await page.selectOption("#tb-block", "h1");
    bl = await blocks(page);
    assert(bl[1].type === "heading" && bl[1].level === 1, "제목 1로 바뀜");
    await page.selectOption("#tb-block", "paragraph");
    await page.keyboard.press("End");
    await page.keyboard.down("Shift"); for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowLeft"); await page.keyboard.up("Shift");
    await page.click("#tb-bold");
    bl = await blocks(page);
    assert(bl[1].type === "paragraph" && bl[1].content.some((n) => n.b && n.text === "문단"), "굵게: " + JSON.stringify(bl[1]));
    await page.click("#tb-undo");
    bl = await blocks(page);
    assert(!bl[1].content.some((n) => n.b), "실행 취소로 굵게 해제");
    await page.click("#tb-redo");
    bl = await blocks(page);
    assert(bl[1].content.some((n) => n.b), "다시 실행");
    await page.click("#tb-undo");
  });

  await test("삽입 메뉴: 키보드로 열고(Enter/↓) 이동하고 Esc로 닫는다", async () => {
    await page.focus("#tb-insert");
    assert((await page.getAttribute("#tb-insert", "aria-haspopup")) === "menu", "aria-haspopup");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#tb-insert-menu:not([hidden])");
    assert((await page.getAttribute("#tb-insert", "aria-expanded")) === "true", "펼침");
    assert(await page.evaluate(() => document.activeElement.id === "tb-table"), "첫 항목에 포커스");
    await page.keyboard.press("ArrowDown");
    assert(await page.evaluate(() => document.activeElement.id === "tb-image"), "↓ 이동");
    await page.keyboard.press("End");
    assert(await page.evaluate(() => document.activeElement.id === "tb-ol"), "End");
    await page.keyboard.press("Escape");
    assert(await page.isHidden("#tb-insert-menu"), "Esc로 닫힘");
    assert(await page.evaluate(() => document.activeElement.id === "tb-insert"), "포커스가 버튼으로");
    const items = await page.$$eval("#tb-insert-menu [role=menuitem]", (els) => els.map((e) => e.textContent));
    for (const want of ["표", "그림…", "수식", "캡션", "그림 목차", "표 목차", "인용", "번호 목록"]) assert(items.includes(want), "메뉴 항목 " + want + ": " + items);
    assert(!items.includes("수식 팔레트"), "수식 팔레트는 수식 입력 창으로 합쳐짐: " + items);
    await page.keyboard.press("ArrowDown");
    await page.waitForSelector("#tb-insert-menu:not([hidden])");
    await page.keyboard.press("Tab");
    assert(await page.isHidden("#tb-insert-menu"), "Tab으로 닫힘");
  });

  await test("그림 3개 중 2번째를 지우면 캡션 번호와 본문 참조가 바뀐다", async () => {
    const svg = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" onload="alert(1)"><script>alert(1)</script><rect width="40" height="20" fill="${c}"/><foreignObject><div>x</div></foreignObject><image href="https://evil.example/x.png"/></svg>`;
    await page.evaluate(async (svgs) => { for (const [s, c] of svgs) await RN.editor.insertFigure({ svg: s, caption: c, meta: { kind: "chart", n: c } }); }, [[svg("red"), "첫 그림"], [svg("green"), "둘째 그림"], [svg("blue"), "셋째 그림"]]);
    const labels = () => page.$$eval(".rn-blk-caption .rn-cap-label", (els) => els.map((e) => e.textContent.trim()));
    assert(JSON.stringify(await labels()) === JSON.stringify(["그림 1.", "그림 2.", "그림 3."]), "처음 번호: " + (await labels()));
    const figs = await page.evaluate(() => RN.editor.getDoc().content.blocks.filter((b) => b.type === "figure"));
    assert(!/script|foreignObject|onload|evil/.test(figs[0].svg), "SVG 정리됨: " + figs[0].svg);
    assert(figs[0].meta && figs[0].meta.kind === "chart", "meta 보존");
    // 마지막 빈 문단에서 @그림 입력 → 참조
    await lastPara(page).click();
    await page.keyboard.type("결과는 @그림");
    await page.waitForSelector("#ed-refpop:not([hidden]) button");
    const opts = await page.$$eval("#ed-refpop button", (els) => els.map((e) => e.textContent));
    assert(opts.length === 3, "후보 3개: " + opts);
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.type(" 과 ");
    await page.keyboard.type("@그림2");
    await page.waitForSelector("#ed-refpop:not([hidden]) button");
    await page.keyboard.press("Enter");
    await page.keyboard.type("를 보라");
    let refs = await page.$$eval(".rn-xref", (els) => els.map((e) => e.textContent));
    assert(JSON.stringify(refs) === JSON.stringify(["그림 3", "그림 2"]), "참조: " + refs);
    const para = (await blocks(page)).find((b) => b.content && b.content.some((n) => n.t === "ref"));
    assert(textOf(para) === "결과는 ¤ 과 ¤를 보라", "참조 앞뒤 글자: " + textOf(para));
    // 2번째 그림 삭제 (캡션도 함께)
    const second = figs[1].id;
    await page.click(`.rn-blk[data-id="${second}"] [data-act="delete"]`);
    assert(JSON.stringify(await labels()) === JSON.stringify(["그림 1.", "그림 2."]), "삭제 후 번호: " + (await labels()));
    refs = await page.$$eval(".rn-xref", (els) => els.map((e) => [e.textContent, e.classList.contains("broken")]));
    assert(refs[0][0] === "그림 2" && !refs[0][1], "그림 3 → 그림 2: " + JSON.stringify(refs));
    assert(refs[1][1] && /참조 대상 없음/.test(refs[1][0]), "지운 그림 참조는 깨진 참조: " + JSON.stringify(refs));
    await page.click("#tb-undo");
    assert(JSON.stringify(await labels()) === JSON.stringify(["그림 1.", "그림 2.", "그림 3."]), "실행 취소로 복구");
    await page.click(`.rn-blk[data-id="${second}"] [data-act="delete"]`);
    // 캡션 단축키: 표 칸을 누르고 Ctrl+Shift+C
    await page.evaluate(() => RN.editor.insertTable({ header: ["x", "y"], rows: [["1", "2"]] }));
    const tbl = await page.evaluate(() => RN.editor.getDoc().content.blocks.find((b) => b.type === "table").id);
    await page.click(`.rn-blk[data-id="${tbl}"] td`);
    await page.keyboard.type("5");
    assert((await blocks(page)).find((b) => b.id === tbl).rows[1][0] === "15", "표 칸 입력");
    await page.keyboard.press("Control+Shift+C");
    const bl = await page.evaluate(() => RN.editor.getDoc().content.blocks.map((b) => b.type + (b.kind ? ":" + b.kind : "")));
    const ti = bl.indexOf("table");
    assert(bl[ti - 1] === "caption:table", "표 캡션은 위에: " + bl);
    await page.keyboard.type("측정값");
    assert((await page.$eval(`.rn-blk-caption[data-kind="table"] .rn-cap-label`, (e) => e.textContent.trim())) === "표 1.", "표 1.");
    assert(textOf((await blocks(page))[ti - 1]) === "측정값", "캡션 글자");
  });

  await test("$$…$$ 블록 수식과 $…$ 인라인 수식(쉬운 표기도 변환), 수식 번호", async () => {
    await lastPara(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("$$E=mc^2$$");
    await page.waitForSelector(".rn-blk-math math");
    assert((await page.$eval(".rn-blk-math .rn-eqno", (e) => e.textContent)) === "(1)", "식 번호 (1)");
    await page.keyboard.type("에너지 $a^2+b^2$ 관계");
    const inline = await page.$$eval(".rn-im", (els) => els.map((e) => [e.dataset.latex, !!e.querySelector("math")]));
    assert(inline.length === 1 && inline[0][0] === "a^2+b^2" && inline[0][1], "인라인 수식: " + JSON.stringify(inline));
    const para = (await blocks(page)).find((b) => b.content && b.content.some((n) => n.t === "math"));
    assert(para && textOf(para) === "에너지 ¤ 관계", "커서 위치 유지: " + JSON.stringify(para));
    // $ 안의 쉬운 표기도 LaTeX로
    await page.keyboard.type(" 그리고 $x^2 + 1/2$");
    const latexes = await page.$$eval(".rn-im", (els) => els.map((e) => e.dataset.latex));
    assert(latexes.length === 2 && latexes[1] === "x^2 + \\frac{1}{2}", "$ 안 쉬운 표기: " + JSON.stringify(latexes));
    await page.evaluate(() => RN.editor.insertLatex("\\int_0^1 x\\,dx", { display: true }));
    const nums = await page.$$eval(".rn-blk-math .rn-eqno", (els) => els.map((e) => e.textContent));
    assert(JSON.stringify(nums) === '["(1)","(2)"]', "식 번호 2개: " + nums);
  });

  await test("easyToLatex: 쉬운 표기 표 (분수·첨자·루트·기호·그리스 문자·함수·합/적분/극한·벡터·절댓값·단위·LaTeX 유지·이상한 입력)", async () => {
    const TABLE = [
      // 분수
      ["a/b", "\\frac{a}{b}"], ["(x+1)/(x-1)", "\\frac{x+1}{x-1}"], ["2x/3", "\\frac{2x}{3}"], ["x+1/2", "x+\\frac{1}{2}"], ["a/b/c", "\\frac{\\frac{a}{b}}{c}"],
      // 거듭제곱·첨자
      ["x^2", "x^2"], ["x^(n+1)", "x^{n+1}"], ["e^-x", "e^{-x}"], ["a_1", "a_1"], ["a_(ij)", "a_{ij}"], ["x^2^3", "{x^2}^3"],
      // 제곱근
      ["sqrt(x)", "\\sqrt{x}"], ["루트(x+1)", "\\sqrt{x+1}"], ["√x", "\\sqrt{x}"], ["√2/2", "\\frac{\\sqrt{2}}{2}"], ["root(3, x)", "\\sqrt[3]{x}"],
      // 곱셈·기호
      ["a*b", "a\\times b"], ["a·b", "a\\cdot b"], ["+-1", "\\pm1"], ["x<=1", "x\\le1"], ["a>=b", "a\\ge b"], ["a!=b", "a\\ne b"], ["a~=b", "a\\approx b"], ["x->0", "x\\to0"], ["inf", "\\infty"], ["무한대", "\\infty"], ["30°", "30^{\\circ}"],
      // 그리스 문자
      ["alpha+beta", "\\alpha+\\beta"], ["Delta x", "\\Delta x"], ["2pir^2", "2\\pi r^2"], ["알파 + 베타", "\\alpha + \\beta"], ["세타", "\\theta"], ["파이", "\\pi"], ["람다", "\\lambda"], ["시그마", "\\sigma"], ["오메가", "\\omega"], ["델타 t", "\\Delta t"],
      // 함수
      ["sin(x)", "\\sin(x)"], ["sinx", "\\sin x"], ["cos^2(x)+sin^2(x)=1", "\\cos^2(x)+\\sin^2(x)=1"], ["log_2(8)", "\\log_2(8)"], ["ln x", "\\ln x"], ["exp(x)", "\\exp(x)"],
      // 합·적분·극한
      ["sum(i=1, n, a_i)", "\\sum_{i=1}^{n} a_i"], ["int(a, b, f(x) dx)", "\\int_{a}^{b} f(x) \\,dx"], ["int(0, 1, x^2 dx)", "\\int_{0}^{1} x^2 \\,dx"], ["lim(x->0, sin(x)/x)", "\\lim_{x\\to0} \\frac{\\sin(x)}{x}"],
      // 벡터·평균·절댓값
      ["vec(a)", "\\vec{a}"], ["vec(AB)", "\\overrightarrow{AB}"], ["bar(x)", "\\bar{x}"], ["hat(y)", "\\hat{y}"], ["|x|", "\\left|x\\right|"], ["|x-1|<2", "\\left|x-1\\right|<2"],
      // 단위
      ["9.8 m/s^2", "9.8\\,\\mathrm{m/s^2}"], ["F = 10 N", "F = 10\\,\\mathrm{N}"], ["v = 3.0 × 10^8 m/s", "v = 3.0 \\times 10^8\\,\\mathrm{m/s}"], ["2 m + 3 x", "2\\,\\mathrm{m} + 3 x"],
      // 종합
      ["x = (-b +- sqrt(b^2-4ac))/(2a)", "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}"],
      // 이미 LaTeX → 그대로
      ["\\frac{a}{b}", "\\frac{a}{b}"], ["\\alpha^{2} + x_{i}", "\\alpha^{2} + x_{i}"], ["E=mc^2", "E=mc^2"],
      // 한글 낱말은 글자로
      ["가속도 = 9.8 m/s^2", "\\text{가속도} = 9.8\\,\\mathrm{m/s^2}"],
    ];
    const WEIRD = ["{{{", "}}}", "((((", "))))", "^^^", "___", "x/", "/x", "|||", "&#%$~", "\"'`", "sum", "int", "( )/( )", "int( ,  , dx)", "lim(x-> , )", "∫x dx", "", "   ", "a//b", "((a)/(b))^", "1,000", "이차방정식 근의 공식", "x^", "sqrt", "root(", "vec()", "√", "!", "°C 25"];
    const r = await page.evaluate(([table, weird]) => {
      const T = RN._test.editor;
      const wrong = [], bad = [];
      const renders = (l) => { try { katex.renderToString(l, { output: "mathml", throwOnError: true }); return true; } catch (e) { return e.message; } };
      for (const [inp, want] of table) {
        const got = T.easyToLatex(inp);
        if (got !== want) wrong.push([inp, got, want]);
        const ok = renders(got); if (ok !== true) bad.push([inp, got, ok]);
      }
      for (const inp of weird) {
        let got;
        try { got = T.easyToLatex(inp); } catch (e) { bad.push([inp, "throw", String(e)]); continue; }
        if (typeof got !== "string") { bad.push([inp, got, "not string"]); continue; }
        const ok = got ? renders(got) : true; if (ok !== true) bad.push([inp, got, ok]);
      }
      // 저장된 LaTeX → 쉬운 표기 (다시 열 때)
      const back = ["\\frac{x+1}{x-1}", "\\sqrt{x}", "\\alpha + \\beta", "\\begin{pmatrix} a \\end{pmatrix}"].map((l) => T.latexToEasy(l));
      return { wrong, bad, back };
    }, [TABLE, WEIRD]);
    assert(!r.wrong.length, "변환 다름:\n" + r.wrong.map((w) => JSON.stringify(w)).join("\n"));
    assert(!r.bad.length, "KaTeX 오류/예외:\n" + r.bad.map((w) => JSON.stringify(w)).join("\n"));
    assert(r.back[0] === "(x+1)/(x-1)" && r.back[1] === "sqrt(x)" && r.back[2] === "alpha + beta" && r.back[3] === null, "latexToEasy: " + JSON.stringify(r.back));
  });

  const mathOpen = (p) => p.waitForSelector("#math-dlg[open]");
  const mathClosed = (p) => p.waitForFunction(() => !document.querySelector("#math-dlg"));

  await test("수식 입력 창: Ctrl+Shift+E → 분수 버튼(첫 괄호에 커서) → 미리보기·LaTeX 보기 → 넣기(글 안) → 문서에 수식 노드, 초점은 본문", async () => {
    await freshDoc(page, projectId, { blocks: [P("a", "속도는 이다")] }, "수식 창");
    await selectText(page, [0, 4], [0, 4]);
    await page.keyboard.press("Control+Shift+E");
    await mathOpen(page);
    assert(await page.evaluate(() => document.activeElement.id === "math-easy"), "입력란에 초점");
    assert(await page.isChecked("#math-mode-inline"), "글 중간이면 '글 안에 넣기'가 기본");
    await page.click("#math-tpls button[aria-label='분수']");
    const st = await page.$eval("#math-easy", (e) => [e.value, e.selectionStart, e.selectionEnd]);
    assert(st[0] === "( )/( )" && st[1] === 1 && st[2] === 2, "분수 틀과 첫 괄호 커서: " + JSON.stringify(st));
    await page.keyboard.type("x+1");
    assert((await page.inputValue("#math-easy")) === "(x+1)/( )", "첫 괄호에 들어감");
    await page.fill("#math-easy", "(x+1)/(x-1)");
    await page.waitForSelector("#math-preview math mfrac");
    assert(!(await page.isVisible("#math-latex")), "LaTeX는 접혀 있음");
    await page.click("#math-latex-more summary");
    assert((await page.inputValue("#math-latex")) === "\\frac{x+1}{x-1}", "변환된 LaTeX");
    assert(await page.isHidden("#math-hint"), "오류 안내 없음");
    // 선택한 글자를 감싸기
    await page.fill("#math-easy", "ab");
    await page.focus("#math-easy");
    await page.keyboard.press("Control+a");
    await page.click("#math-tpls button[aria-label='제곱근']");
    assert((await page.inputValue("#math-easy")) === "sqrt(ab)", "선택 감싸기: " + (await page.inputValue("#math-easy")));
    // 도구 모음은 화살표로 이동
    await page.focus("#math-tpls button[tabindex='0']");
    await page.keyboard.press("ArrowRight");
    assert(await page.evaluate(() => document.activeElement.getAttribute("aria-label") === "제곱"), "→ 다음 버튼");
    await page.fill("#math-easy", "(x+1)/(x-1)");
    await page.focus("#math-easy");
    await page.keyboard.press("Enter");
    await mathClosed(page);
    const b = (await blocks(page))[0];
    assert(textOf(b) === "속도는 ¤이다" && b.content.find((n) => n.t === "math").latex === "\\frac{x+1}{x-1}", "인라인 수식: " + JSON.stringify(b));
    assert(await page.evaluate(() => document.activeElement.id === "ed-blocks"), "초점이 본문으로");
    await page.waitForSelector(".rn-im math");
  });

  await test("수식 입력 창: 기존 인라인 수식 눌러 고치기(쉬운 표기로 열림), Esc로 닫기·초점 복귀, LaTeX 직접 고치기 우선, 이해 못한 부분 안내", async () => {
    await page.click(".rn-im");
    await mathOpen(page);
    assert((await page.textContent("#math-dlg-title")) === "수식 고치기", "제목");
    assert((await page.inputValue("#math-easy")) === "(x+1)/(x-1)", "쉬운 표기로 열림: " + (await page.inputValue("#math-easy")));
    await page.keyboard.press("Escape");
    await mathClosed(page);
    assert(await page.evaluate(() => document.activeElement.id === "ed-blocks"), "Esc 뒤 초점 본문");
    await page.dblclick(".rn-im");
    await mathOpen(page);
    await page.fill("#math-easy", "(x+1)/(x+2)");
    await page.click("#math-insert");
    await mathClosed(page);
    let ms = (await blocks(page))[0].content.filter((n) => n.t === "math");
    assert(ms.length === 1 && ms[0].latex === "\\frac{x+1}{x+2}", "고침: " + JSON.stringify(ms));
    // LaTeX 직접 고치기
    await page.click(".rn-im");
    await mathOpen(page);
    await page.click("#math-latex-more summary");
    await page.fill("#math-latex", "\\frac{1}{");
    await page.waitForSelector("#math-hint:not([hidden])");
    assert(/이해하지 못했어요/.test(await page.textContent("#math-hint")), "안내 한 줄");
    await page.fill("#math-latex", "x^{3}");
    assert(await page.isHidden("#math-hint"), "고치면 안내 사라짐");
    await page.click("#math-insert");
    await mathClosed(page);
    ms = (await blocks(page))[0].content.filter((n) => n.t === "math");
    assert(ms[0].latex === "x^{3}", "LaTeX가 우선: " + JSON.stringify(ms));
  });

  await test("수식 입력 창: 빈 문단이면 '한 줄로 넣기'(번호), 블록 수식 다시 열기·Esc, '/수식'+Enter로 열기", async () => {
    await lastPara(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await insertMenu(page, "tb-math");
    await mathOpen(page);
    assert(await page.isChecked("#math-mode-display"), "빈 문단이면 블록이 기본");
    await page.keyboard.type("sum(i=1, n, a_i)");
    await page.keyboard.press("Enter");
    await mathClosed(page);
    let bl = await blocks(page);
    const m = bl.find((b) => b.type === "math");
    assert(m && m.latex === "\\sum_{i=1}^{n} a_i", "블록 수식: " + JSON.stringify(bl));
    assert((await page.$eval(".rn-blk-math .rn-eqno", (e) => e.textContent)) === "(1)", "번호");
    await page.click(".rn-blk-math .rn-math-view");
    await mathOpen(page);
    assert((await page.inputValue("#math-easy")) === "sum_(i=1)^n a_i", "블록 수식 쉬운 표기: " + (await page.inputValue("#math-easy")));
    assert(await page.isHidden(".rn-mathdlg-mode"), "고칠 때는 넣는 방식 숨김");
    await page.keyboard.press("Escape");
    await mathClosed(page);
    assert(await page.evaluate(() => document.activeElement.classList.contains("rn-blk-math")), "Esc 뒤 초점이 그 수식으로");
    await page.keyboard.press("Enter");
    await mathOpen(page);
    await page.click("#math-cancel");
    await mathClosed(page);
    // /수식 + Enter
    await lastPara(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type("/수식");
    await page.keyboard.press("Enter");
    await mathOpen(page);
    await page.keyboard.type("1/2 m v^2");
    await page.keyboard.press("Enter");
    await mathClosed(page);
    bl = await blocks(page);
    assert(bl.filter((b) => b.type === "math").map((b) => b.latex).join("|") === "\\sum_{i=1}^{n} a_i|\\frac{1}{2} m v^2", "/수식으로 넣음: " + JSON.stringify(bl.map((b) => b.type + ":" + (b.latex || textOf(b)))));
    assert(!bl.some((b) => b.content && /\/수식/.test(textOf(b))), "/수식 글자는 지워짐");
  });

  await test("수식 입력 창: 말로 설명해서 만들기(quick, 누를 때만 호출, 넣기 전에는 문서 그대로), ?nosample=1이면 버튼 없음", async () => {
    await page.evaluate(() => { window.__aiCalls = []; window.__mockSample = async (text, opts) => { window.__aiCalls.push({ text, tier: opts && opts.modelTier }); return "```latex\n$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$\n```"; }; });
    const before = JSON.stringify(await blocks(page));
    await lastPara(page).click();
    await page.keyboard.press("Control+Shift+E");
    await mathOpen(page);
    assert((await page.evaluate(() => window.__aiCalls.length)) === 0, "열기만 해서는 호출 안 함");
    await page.click("#math-ai-toggle");
    await page.fill("#math-ai-q", "이차방정식 근의 공식");
    await page.click("#math-ai-go");
    await page.waitForFunction(() => /만들었어요/.test(document.querySelector("#math-ai-status").textContent));
    const calls = await page.evaluate(() => window.__aiCalls);
    assert(calls.length === 1 && calls[0].tier === "quick" && /근의 공식/.test(calls[0].text), "sample 호출: " + JSON.stringify(calls));
    assert((await page.inputValue("#math-easy")) === "x = (-b +- sqrt(b^2-4ac))/2a", "쉬운 표기로 채움: " + (await page.inputValue("#math-easy")));
    await page.waitForSelector("#math-preview math mfrac");
    assert(JSON.stringify(await blocks(page)) === before, "넣기 전에는 문서 그대로");
    // 오류 코드: 한도·거절
    await page.evaluate(() => { window.__mockSample = async () => { throw { code: "rate_limited", message: "x" }; }; });
    await page.fill("#math-ai-q", "다른 수식");
    await page.click("#math-ai-go");
    await page.waitForFunction(() => /잠시 뒤/.test(document.querySelector("#math-ai-status").textContent));
    assert(await page.isVisible("#math-ai-toggle"), "rate_limited는 버튼 유지");
    await page.click("#math-insert");
    await mathClosed(page);
    const mm = (await blocks(page)).filter((b) => b.type === "math").pop();
    assert(mm.latex === "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}", "넣은 수식: " + mm.latex);
    // not_granted → 버튼 숨김
    await page.evaluate(() => { window.__mockSample = async () => { throw { code: "not_granted", message: "x" }; }; });
    await page.keyboard.press("Control+Shift+E");
    await mathOpen(page);
    await page.click("#math-ai-toggle");
    await page.fill("#math-ai-q", "원의 넓이");
    await page.click("#math-ai-go");
    await page.waitForFunction(() => document.querySelector("#math-ai-toggle").hidden);
    await page.keyboard.press("Escape");
    await mathClosed(page);
    await page.evaluate(() => { window.__mockSample = null; });
    // ?nosample=1
    const ctxN = await setupContext();
    const pN = await newPage(ctxN, "?nosample=1");
    await pN.evaluate((s) => window.__mockDb.seed(s), await store(page));
    await openEditor(pN, projectId, docId);
    await pN.click("#ed-blocks .rn-slot");
    await pN.keyboard.press("Control+Shift+E");
    await mathOpen(pN);
    assert(!(await pN.$("#math-ai-toggle")), "sample이 없으면 버튼 없음");
    await ctxN.close();
  });

  await test("수식 입력 창: 휴대폰 폭(400px)에서 가로 스크롤 없이, 더 보기 펼쳐도 화면 안", async () => {
    const ctx4 = await setupContext({ width: 400, height: 800 });
    const p = await newPage(ctx4);
    await p.evaluate((s) => window.__mockDb.seed(s), await store(page));
    await openEditor(p, projectId, docId);
    await p.click("#ed-blocks .rn-slot");
    await p.keyboard.press("Control+Shift+E");
    await mathOpen(p);
    await p.click("#math-more");
    await p.waitForSelector("#math-more-row:not([hidden])");
    await p.fill("#math-easy", "int(0, 1, (x^2 + 2x + 1)/(sqrt(x) + 1) dx) + sum(k=1, inf, 1/k^2)");
    await p.click("#math-latex-more summary");
    const r = await p.evaluate(() => {
      const d = document.getElementById("math-dlg"), b = d.getBoundingClientRect();
      return { left: b.left, right: b.right, vw: window.innerWidth, sw: d.scrollWidth, cw: d.clientWidth, doc: document.documentElement.scrollWidth };
    });
    assert(r.left >= 0 && r.right <= r.vw && r.sw <= r.cw && r.doc <= r.vw, "화면 안: " + JSON.stringify(r));
    await p.keyboard.press("Escape");
    await ctx4.close();
    await openEditor(page, projectId, docId);
  });

  await test("Markdown 가져오기의 그림: data: 래스터 → figure(alt만, 캡션 없음), 위험한 주소는 글자, 크기 제한이면 생략", async () => {
    const r = await page.evaluate(async (pid) => {
      const png = (w, h, noise) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
        if (noise) { const im = x.createImageData(w, h); for (let i = 0; i < im.data.length; i++) im.data[i] = (Math.random() * 256) | 0; x.putImageData(im, 0, 0); } else { x.fillStyle = "#c33"; x.fillRect(0, 0, w, h); }
        return c.toDataURL("image/png"); };
      const small = png(40, 30), jpg = (() => { const c = document.createElement("canvas"); c.width = 20; c.height = 20; return c.toDataURL("image/jpeg"); })();
      const md = `# 결과\n\n첫 문단\n\n![실험 장치](${small})\n\n둘째 문단\n\n![](${jpg})\n\n![나쁜 그림](javascript:alert(1))\n\n![원격](https://evil.example/x.png)\n\n![svg](data:image/svg+xml;base64,PHN2Zy8+)\n\n끝`;
      const id1 = await RN.docs.createDoc(pid, { title: "그림 가져오기", markdown: md, reason: "IMPORT" });
      const info1 = RN.docs.lastImportInfo;
      const d1 = await RN.docs.getDoc(id1);
      // 큰 그림 여러 개(잡음이라 잘 안 줄어듦) → 크기 제한
      const big = png(700, 500, true);
      const md2 = ["시작", ...Array.from({ length: 6 }, (_, i) => `![큰 그림 ${i + 1}](${big})`), "끝"].join("\n\n");
      const id2 = await RN.docs.createDoc(pid, { title: "큰 그림", markdown: md2 });
      const info2 = RN.docs.lastImportInfo;
      const d2 = await RN.docs.getDoc(id2);
      return { info1, info2, b1: d1.content.blocks, b2: d2.content.blocks, bytes2: new TextEncoder().encode(JSON.stringify(d2)).length, bigLen: big.length };
    }, projectId);
    const figs = r.b1.filter((b) => b.type === "figure");
    assert(figs.length === 2 && figs[0].alt === "실험 장치" && figs[1].alt === "" && /^data:image\/png;base64,/.test(figs[0].src) && /^data:image\/jpeg;base64,/.test(figs[1].src), "figure 2개: " + JSON.stringify(r.b1.map((b) => b.type + ":" + (b.alt ?? textOf(b)))));
    assert(!r.b1.some((b) => b.type === "caption"), "캡션 블록 없음");
    const texts = r.b1.filter((b) => b.type === "paragraph").map(textOf);
    assert(texts.includes("(그림: 나쁜 그림)") && texts.includes("(그림: 원격)") && texts.includes("(그림: svg)"), "위험한 주소는 글자: " + texts);
    assert(!JSON.stringify(r.b1).includes("javascript:") && !JSON.stringify(r.b1).includes("evil.example"), "주소가 남지 않음");
    assert(r.info1.imagesKept === 2 && r.info1.imagesSkipped === 0, "info1 " + JSON.stringify(r.info1));
    const kept2 = r.b2.filter((b) => b.type === "figure").length, skippedText = r.b2.filter((b) => b.type === "paragraph" && textOf(b) === "(그림 생략: 문서 크기 제한)").length;
    assert(r.info2.imagesSkipped > 0 && r.info2.imagesKept === kept2 && skippedText === r.info2.imagesSkipped && kept2 + skippedText === 6, "생략: " + JSON.stringify([r.info2, kept2, skippedText, r.bigLen]));
    assert(r.bytes2 <= 256 * 1024, "256KiB 이하: " + r.bytes2);
    assert(r.b2.every((b) => b.type !== "figure" || b.src.length <= 180000), "그림이 줄어 있음");
  });

  await test("서식 패널: 자주 쓰는 항목만 먼저, 나머지는 '자세히' — 종이에 즉시 반영, 프리셋·글꼴 대체", async () => {
    await openPanel(page, "format");
    assert(await page.isVisible("#fmt-body-size") && await page.isVisible("#fmt-page-size") && await page.isVisible("#fmt-line-height") && await page.isVisible("#fmt-body-font"), "자주 쓰는 항목 보임");
    assert(await page.isHidden("#fmt-m-top") && await page.isHidden("#fmt-h1-size"), "나머지는 자세히 안에");
    await page.fill("#fmt-body-size", "14");
    await page.dispatchEvent("#fmt-body-size", "change");
    let fsz = await firstPara(page).evaluate((e) => getComputedStyle(e).fontSize);
    assert(Math.abs(parseFloat(fsz) - 14 * 4 / 3) < 0.1, "본문 14pt: " + fsz);
    await page.selectOption("#fmt-preset", "preset-academic");
    const ff = await firstPara(page).evaluate((e) => getComputedStyle(e).fontFamily);
    assert(/Noto Serif KR/.test(ff), "학술 논문형 글꼴: " + ff);
    const indent = await firstPara(page).evaluate((e) => getComputedStyle(e).textIndent);
    assert(Math.abs(parseFloat(indent) - 10 * 4 / 3) < 0.1, "들여쓰기 10pt: " + indent);
    await page.click("#fmt-more > summary");
    await page.fill("#fmt-font-name", "함초롬바탕");
    await page.click("#fmt-font-apply");
    await page.waitForFunction(() => /함초롬바탕.*대체/.test(document.querySelector("#fmt-form").textContent));
    const r = await page.evaluate(() => RN.editor.applyFormat({ headings: { h1: { align: "right" } } }));
    assert(r.rules.headings.h1.align === "right" && r.rules.body.font === "noto-serif-kr", "applyFormat 부분 합치기");
    await page.fill("#fmt-tpl-name", "우리 학교 양식");
    await page.click("#fmt-tpl-save");
    await page.waitForFunction(() => [...document.querySelectorAll("#fmt-preset option")].some((o) => o.textContent === "우리 학교 양식"));
    const s = await store(page);
    assert(Object.keys(s).some((k) => k.startsWith("data/users/u1/formatTemplates/items/")), "템플릿 개인 경로");
    await waitSaved(page);
    const d = (await store(page))[docPath("u1", docId)];
    assert(d.formatRules && d.formatRules.body.font === "noto-serif-kr", "서식 규칙이 문서에 저장됨");
    // 닫기 버튼과 Esc
    await page.click("#ed-panel-close");
    assert(await page.isHidden("#ed-side"), "닫기로 접힘");
    assert((await page.getAttribute("#edtab-format", "aria-expanded")) === "false", "aria-expanded false");
  });

  await test("서식 검사(서식 패널 안 구역)와 모두 고치기", async () => {
    const issues = await page.evaluate(() => {
      const T = RN._test.editor;
      const doc = { blocks: [
        { id: "h1", type: "heading", level: 1, content: [{ t: "text", text: "서론" }] },
        { id: "h3", type: "heading", level: 3, content: [{ t: "text", text: "세부" }] },
        { id: "f1", type: "figure", svg: "<svg xmlns='http://www.w3.org/2000/svg'/>", alt: "" },
        { id: "t1", type: "table", rows: [["a"]] },
        { id: "c1", type: "caption", kind: "table", content: [{ t: "text", text: "표 3. 결과" }] },
        { id: "p1", type: "paragraph", content: [{ t: "ref", target: "없음" }] },
      ] };
      const list = T.checkFormat(doc, T.DEFAULT_RULES);
      const fixed = T.fixFormat(doc, T.DEFAULT_RULES, { newId: (() => { let i = 0; return () => "n" + ++i; })() });
      return { codes: list.map((i) => i.code), fixedTypes: fixed.doc.blocks.map((b) => b.type + (b.level || "")), fixed: fixed.fixed, remaining: fixed.remaining.map((i) => i.code), capText: fixed.doc.blocks.find((b) => b.id === "c1").content };
    });
    for (const c of ["heading-skip", "caption-missing", "caption-position", "number-mismatch", "broken-ref"]) assert(issues.codes.includes(c), c + " 없음: " + issues.codes);
    assert(JSON.stringify(issues.fixedTypes) === JSON.stringify(["heading1", "heading2", "figure", "caption", "caption", "table", "paragraph"]), "고친 순서: " + issues.fixedTypes);
    assert(JSON.stringify(issues.remaining) === JSON.stringify(["caption-empty", "broken-ref"]), "남은 것: " + issues.remaining);
    assert(issues.capText[0].text === "결과", "손으로 쓴 번호 제거");
    await page.evaluate(() => RN.editor.insertFigure({ svg: "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>" }));
    await openPanel(page, "format");
    assert(!(await page.$("#edtab-check")), "서식 검사 탭은 따로 없음");
    await page.waitForSelector('#edpanel-format #fmt-issues [data-code="caption-missing"]');
    await page.click("#fmt-fix-all");
    await page.waitForFunction(() => !document.querySelector('#fmt-issues [data-code="caption-missing"]'));
  });

  await test("그림 목차·표 목차 블록 (삽입 메뉴)", async () => {
    await insertMenu(page, "tb-toc-fig");
    const lines = await page.$$eval(".rn-blk-toc .rn-toc-body p", (els) => els.map((e) => e.textContent));
    assert(lines[0] === "그림 목차" && lines[1] === "그림 1. 첫 그림" && lines[2] === "그림 2. 셋째 그림", "그림 목차: " + lines);
  });

  await test("내보내기: Markdown, HTML(독립 문서), 보고서용 exportHtml", async () => {
    await openPanel(page, "export");
    await page.evaluate(() => { window.__downloads = []; });
    await page.click("#exp-md");
    await page.click("#exp-html");
    await page.waitForFunction(() => window.__downloads.length === 2);
    const dls = await page.evaluate(() => window.__downloads);
    assert(dls[0].filename === "실험 보고서.md", dls[0].filename);
    assert(/\*그림 1\. 첫 그림\*/.test(dls[0].data) && /그림 2/.test(dls[0].data) && /\$\$\nE=mc\^2\n\$\$ \(1\)/.test(dls[0].data), "md 내용");
    assert(/^<!doctype html>/.test(dls[1].data) && /<math/.test(dls[1].data) && /Noto Serif KR/.test(dls[1].data) && /@page/.test(dls[1].data), "html 문서");
    assert(/PDF/.test(await page.textContent("#exp-pdf-note")), "PDF 안내");
    const body = await page.evaluate(async (id) => RN.docs.exportHtml(await RN.docs.getDoc(id)), docId);
    assert(!/<script|onload|onerror|on\w+=/.test(body), "스크립트·이벤트 속성 없음");
    assert(/<math/.test(body) && /caption-label">그림 1\./.test(body) && /doc-xref">그림 2</.test(body), "번호·참조·MathML");
    const big = await page.evaluate(() => {
      const src = "data:image/png;base64," + "A".repeat(300 * 1024);
      return RN.docs.exportHtml({ content: { blocks: [{ id: "f", type: "figure", src }, { id: "p", type: "paragraph", content: [{ t: "text", text: "<img onerror=x>" }] }] } });
    });
    assert(new TextEncoder().encode(big).length < 200 * 1024 && /그림 생략/.test(big) && /&lt;img onerror=x&gt;/.test(big), "큰 그림 생략, 글자 이스케이프");
  });

  await test("스냅샷: 버전 기록 패널의 '버전 저장' → 바꾸기 → 복원 (복원 전 스냅샷도 남음)", async () => {
    await waitSaved(page);
    await openPanel(page, "history");
    await page.click("#ver-save");
    await page.waitForSelector("#ver-list .rn-snap");
    const p = firstPara(page);
    await p.click(); await page.keyboard.press("End");
    await page.keyboard.type(" 바뀐 내용");
    assert(/바뀐 내용/.test(await p.textContent()), "바뀜");
    await page.click("#ver-list .rn-snap button");
    await page.click("dialog button:has-text('복원')");
    await page.waitForFunction(() => !/바뀐 내용/.test(document.querySelector("#ed-blocks > .rn-blk-paragraph").textContent));
    await page.waitForFunction(() => document.querySelectorAll("#ver-list .rn-snap").length === 2);
    const labels = await page.$$eval("#ver-list .rn-snap .rn-badge", (els) => els.map((e) => e.textContent));
    assert(labels.includes("복원 전") && labels.includes("직접 저장"), "스냅샷 종류: " + labels);
    await waitSaved(page);
    await page.click("#ed-panel-close");
  });

  await test("버전 충돌: 다른 탭이 먼저 저장 → 충돌 안내 → 서버 버전 불러오기 / 내 버전 유지", async () => {
    const page2 = await newPage(ctx);
    await openEditor(page2, projectId, docId);
    await firstPara(page2).click(); await page2.keyboard.press("End");
    await page2.keyboard.type(" 다른 탭");
    await waitSaved(page2);
    const serverDoc = (await store(page2))[docPath("u1", docId)];
    await page.evaluate(([p, d]) => window.__mockDb.seed({ [p]: d }), [docPath("u1", docId), serverDoc]);
    await firstPara(page).click(); await page.keyboard.press("End");
    await page.keyboard.type(" 내 탭");
    await page.waitForSelector("#ed-conflict", { timeout: 8000 });
    assert(/충돌/.test(await page.textContent("#ed-status")), "상태: 충돌");
    await page.click("#ed-use-server");
    await page.waitForFunction(() => /다른 탭/.test(document.querySelector("#ed-blocks .rn-slot").textContent) && /^저장됨/.test(document.querySelector("#ed-status").textContent));
    assert(!/내 탭/.test(await firstPara(page).textContent()), "서버 버전으로 바뀜");
    await page2.keyboard.type(" 둘째");
    await waitSaved(page2);
    const sd2 = (await store(page2))[docPath("u1", docId)];
    await page.evaluate(([p, d]) => window.__mockDb.seed({ [p]: d }), [docPath("u1", docId), sd2]);
    await firstPara(page).click(); await page.keyboard.press("End");
    await page.keyboard.type(" 유지");
    await page.waitForSelector("#ed-conflict", { timeout: 8000 });
    await page.click("#ed-keep-mine");
    await waitSaved(page);
    const d = (await store(page))[docPath("u1", docId)];
    assert(/유지/.test(JSON.stringify(d.content)) && d.version === sd2.version + 1, "내 버전으로 덮어씀, version " + d.version);
    await page2.close();
  });

  await test("로컬 초안 복구 제안", async () => {
    await firstPara(page).click(); await page.keyboard.press("End");
    await page.keyboard.type(" 초안만");
    await sleep(500);
    await page.evaluate(() => Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true }));
    await page.reload();
    await page.waitForFunction(() => window.RN && RN.docs);
    await page.evaluate(() => RN.ready);
    await openEditor(page, projectId, docId);
    await page.waitForSelector("#ed-draft");
    assert(!/초안만/.test(await firstPara(page).textContent()), "서버 내용이 먼저 보임");
    await page.click("#ed-draft-restore");
    assert(/초안만/.test(await firstPara(page).textContent()), "초안 복구");
    await waitSaved(page);
  });

  await test("오프라인에서 쓰고 온라인이 되면 자동 동기화", async () => {
    await ctx.setOffline(true);
    await page.waitForFunction(() => /오프라인/.test(document.querySelector("#ed-status").textContent));
    await firstPara(page).click(); await page.keyboard.press("End");
    await page.keyboard.type(" 오프라인 글");
    await sleep(2600);
    assert(/오프라인/.test(await page.textContent("#ed-status")), "여전히 오프라인");
    assert(!/오프라인 글/.test(JSON.stringify((await store(page))[docPath("u1", docId)].content)), "아직 저장 안 됨");
    await ctx.setOffline(false);
    await waitSaved(page);
    assert(/오프라인 글/.test(JSON.stringify((await store(page))[docPath("u1", docId)].content)), "온라인 복귀 뒤 저장");
  });

  // ---------------- 2차: 여러 블록에 걸친 선택 ----------------
  await test("여러 문단 선택: Shift+→로 문단 경계를 넘어 고르고 Backspace → 두 문단이 합쳐짐", async () => {
    await freshDoc(page, projectId, { blocks: [P("a", "첫째 문단"), P("b", "둘째 문단"), P("c", "셋째 문단")] });
    await page.locator("#ed-blocks > .rn-blk").first().click();
    await page.keyboard.press("End");
    await page.keyboard.down("Shift"); for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight"); await page.keyboard.up("Shift");
    const selText = await page.evaluate(() => RN.editor.getSelectionText());
    assert(selText === "\n둘째", "선택 글자: " + JSON.stringify(selText));
    await page.keyboard.press("Backspace");
    const bl = await blocks(page);
    assert(bl.length === 2 && textOf(bl[0]) === "첫째 문단 문단" && textOf(bl[1]) === "셋째 문단", "합쳐짐: " + bl.map(textOf));
    await page.keyboard.type("!");
    assert(textOf((await blocks(page))[0]) === "첫째 문단! 문단", "커서가 합친 자리에: " + textOf((await blocks(page))[0]));
  });

  await test("여러 문단 선택(마우스로 끈 것과 같은 범위) → 입력하면 바꾸고, 실행 취소로 되돌림", async () => {
    await freshDoc(page, projectId, { blocks: [P("a", "가나다라"), P("b", "마바사"), P("c", "아자차카")] });
    await selectText(page, [0, 2], [2, 2]);
    assert((await page.evaluate(() => RN.editor.getSelectionText())) === "다라\n마바사\n아자", "선택 글자");
    await page.keyboard.type("X");
    let bl = await blocks(page);
    assert(bl.length === 1 && textOf(bl[0]) === "가나X차카", "바꿈: " + bl.map(textOf));
    await page.keyboard.press("Control+z");
    bl = await blocks(page);
    assert(bl.length === 3 && textOf(bl[0]) === "가나다라" && textOf(bl[2]) === "아자차카", "실행 취소: " + bl.map(textOf));
    // Delete 키로도
    await selectText(page, [0, 1], [1, 1]);
    await page.keyboard.press("Delete");
    bl = await blocks(page);
    assert(bl.length === 2 && textOf(bl[0]) === "가바사", "Delete: " + bl.map(textOf));
  });

  await test("여러 문단에 굵게·기울임(Ctrl+B/I, 버튼)과 문단 종류 바꾸기, 목록", async () => {
    await freshDoc(page, projectId, { blocks: [P("a", "하나 둘"), P("b", "셋 넷"), P("c", "다섯")] });
    await selectText(page, [0, 3], [1, 1]);
    await page.keyboard.press("Control+b");
    let bl = await blocks(page);
    assert(JSON.stringify(bl[0].content) === JSON.stringify([{ t: "text", text: "하나 " }, { t: "text", text: "둘", b: true }]), "첫 문단 굵게: " + JSON.stringify(bl[0].content));
    assert(JSON.stringify(bl[1].content) === JSON.stringify([{ t: "text", text: "셋", b: true }, { t: "text", text: " 넷" }]), "둘째 문단 굵게: " + JSON.stringify(bl[1].content));
    await page.click("#tb-italic");
    bl = await blocks(page);
    assert(bl[0].content[1].i && bl[1].content[0].i, "기울임 버튼");
    await page.keyboard.press("Control+b");
    bl = await blocks(page);
    assert(!bl[0].content.some((n) => n.b) && !bl[1].content.some((n) => n.b), "다시 누르면 굵게 해제");
    // 선택이 유지된 채 문단 종류 바꾸기
    await page.selectOption("#tb-block", "h2");
    bl = await blocks(page);
    assert(bl[0].type === "heading" && bl[0].level === 2 && bl[1].type === "heading" && bl[1].level === 2 && bl[2].type === "paragraph", "두 문단이 제목 2: " + bl.map((b) => b.type));
    await page.selectOption("#tb-block", "paragraph");
    await page.click("#tb-ul");
    bl = await blocks(page);
    assert(bl[0].type === "list" && !bl[0].ordered && bl[0].items.length === 2 && bl[1].type === "paragraph", "목록 하나로: " + JSON.stringify(bl.map((b) => b.type)));
    await insertMenu(page, "tb-ol");
    bl = await blocks(page);
    assert(bl[0].type === "list" && bl[0].ordered, "번호 목록");
    await insertMenu(page, "tb-quote");
    bl = await blocks(page);
    assert(bl[0].type === "quote" && bl[1].type === "quote" && bl[2].type === "paragraph", "인용: " + bl.map((b) => b.type));
    // 목록 안 Enter/빈 항목 Enter → 목록 밖으로
    await freshDoc(page, projectId, { blocks: [{ id: "l", type: "list", ordered: false, items: [[{ t: "text", text: "항목" }]] }] });
    await page.click("#ed-blocks li");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("둘");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("밖");
    bl = await blocks(page);
    assert(bl[0].type === "list" && bl[0].items.length === 2 && bl[1].type === "paragraph" && textOf(bl[1]) === "밖", "목록: " + JSON.stringify(bl));
  });

  await test("여러 문단 복사·잘라내기·붙여넣기(글자만)", async () => {
    await freshDoc(page, projectId, { blocks: [P("a", "알파 베타"), { id: "b", type: "paragraph", content: [{ t: "text", text: "감마 " }, { t: "math", latex: "x^2" }, { t: "text", text: " 델타", b: true }] }, P("c", "엡실론")] });
    await page.evaluate(() => { window.__clip = []; document.addEventListener("copy", (e) => window.__clip.push(e.clipboardData.getData("text/plain"))); document.addEventListener("cut", (e) => window.__clip.push(e.clipboardData.getData("text/plain"))); });
    await selectText(page, [0, 3], [1, 2]);
    await page.keyboard.press("Control+c");
    await page.waitForFunction(() => window.__clip.length === 1);
    assert((await page.evaluate(() => window.__clip[0])) === "베타\n감마", "복사: " + (await page.evaluate(() => window.__clip[0])));
    assert((await blocks(page)).length === 3, "복사는 그대로");
    // 수식이 낀 범위를 잘라내기
    await selectText(page, [1, 0], [2, 2]);
    await page.keyboard.press("Control+x");
    await page.waitForFunction(() => window.__clip.length === 2);
    assert((await page.evaluate(() => window.__clip[1])) === "감마 $x^2$ 델타\n엡실", "잘라내기 글자: " + (await page.evaluate(() => window.__clip[1])));
    let bl = await blocks(page);
    assert(bl.length === 2 && textOf(bl[1]) === "론", "잘라낸 뒤: " + bl.map(textOf));
    // 붙여넣기: 여러 줄 글자 → 문단들 (서식 없이)
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "하나\r\n\r\n둘\n셋");
      dt.setData("text/html", "<b>무시</b>");
      document.querySelector("#ed-blocks").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    bl = await blocks(page);
    assert(JSON.stringify(bl.map(textOf)) === JSON.stringify(["알파 베타", "하나", "둘", "셋론"]), "붙여넣기: " + JSON.stringify(bl.map(textOf)));
    assert(!JSON.stringify(bl).includes("무시") && !bl.some((b) => b.content.some((n) => n.b)), "글자만");
    await page.keyboard.type("!");
    assert(textOf((await blocks(page))[3]) === "셋!론", "붙여넣은 끝에 커서");
    // 실제 Ctrl+V(브라우저 클립보드)도 같은 길로
    await selectText(page, [0, 0], [0, 2]);
    await page.keyboard.press("Control+c");
    await selectText(page, [1, 0], [1, 0]);
    const ok = await page.evaluate(() => navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText().then(() => true, () => false) : false).catch(() => false);
    if (ok) {
      await page.keyboard.press("Control+v");
      await sleep(100);
      assert(textOf((await blocks(page))[1]) === "알파하나", "Ctrl+V: " + textOf((await blocks(page))[1]));
    }
  });

  await test("그림을 사이에 둔 범위 지우기: 그림도 함께 지워지고 앞뒤 문단이 합쳐짐", async () => {
    await freshDoc(page, projectId, { blocks: [P("a", "앞 문단"), { id: "f", type: "figure", svg: "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='10'/>", alt: "x" }, { id: "fc", type: "caption", kind: "figure", content: [{ t: "text", text: "캡" }] }, P("c", "뒤 문단")] });
    await selectText(page, [0, 2], [3, 2]);
    await page.waitForFunction(() => document.querySelector(".rn-atom.rn-sel"));
    await page.keyboard.press("Backspace");
    const bl = await blocks(page);
    assert(bl.length === 1 && textOf(bl[0]) === "앞 문단", "합쳐짐: " + JSON.stringify(bl.map((b) => b.type + ":" + textOf(b))));
    await page.keyboard.press("Control+z");
    assert((await blocks(page)).some((b) => b.type === "figure"), "실행 취소로 그림 복구");
    // 그림을 누르고 Delete
    await page.click('.rn-blk[data-id="f"] img');
    assert(await page.evaluate(() => document.activeElement.dataset.id === "f"), "그림에 포커스");
    await page.keyboard.press("Delete");
    assert(!(await blocks(page)).some((b) => b.type === "figure" || b.type === "caption"), "그림과 캡션 삭제");
  });

  // ---------------- 2차: 한글 조합 입력 ----------------
  await test("한글: keyboard.insertText / keyboard.type", async () => {
    await freshDoc(page, projectId, { blocks: [P("a", "")] });
    await page.click("#ed-blocks > .rn-blk");
    await page.keyboard.insertText("한글 입력");
    await page.keyboard.type("이 잘 된다");
    const bl = await blocks(page);
    assert(textOf(bl[0]) === "한글 입력이 잘 된다", "insertText: " + textOf(bl[0]));
    assert((await page.textContent("#ed-blocks > .rn-blk")) === "한글 입력이 잘 된다", "화면");
  });

  await test("한글: 실제 조합 이벤트(IME, CDP imeSetComposition)로 '한글' — 조합 중 다시 그리지 않고 끝나면 모델에 반영", async () => {
    await freshDoc(page, projectId, { blocks: [P("a", "앞"), P("b", "뒤")] });
    await page.locator("#ed-blocks > .rn-blk").first().click();
    await page.keyboard.press("End");
    await page.evaluate(() => { window.__ev = []; const ed = document.querySelector("#ed-blocks"); for (const t of ["compositionstart", "compositionupdate", "compositionend"]) ed.addEventListener(t, (e) => window.__ev.push(t + ":" + e.data)); window.__slot = document.querySelector("#ed-blocks > .rn-blk"); });
    const cdp = await page.context().newCDPSession(page);
    const compose = async (steps, commit) => {
      for (const s of steps) await cdp.send("Input.imeSetComposition", { text: s, selectionStart: s.length, selectionEnd: s.length });
      await cdp.send("Input.insertText", { text: commit });
    };
    await compose(["ㅎ", "하", "한"], "한");
    const mid = await page.evaluate(() => ({ same: window.__slot === document.querySelector("#ed-blocks > .rn-blk"), text: document.querySelector("#ed-blocks > .rn-blk").textContent }));
    assert(mid.text === "앞한", "첫 글자 뒤 화면: " + mid.text);
    await compose(["ㄱ", "그", "글"], "글");
    await sleep(50);
    const ev = await page.evaluate(() => window.__ev);
    assert(ev.includes("compositionstart:") || ev.some((e) => e.startsWith("compositionstart")), "조합 이벤트가 났다: " + ev);
    assert(ev.filter((e) => e.startsWith("compositionend")).length === 2, "조합 두 번: " + ev);
    let bl = await blocks(page);
    assert(textOf(bl[0]) === "앞한글" && textOf(bl[1]) === "뒤", "모델: " + bl.map(textOf));
    assert((await page.textContent("#ed-blocks > .rn-blk")) === "앞한글", "화면에 겹친 글자 없음");
    // 조합 중(끝나기 전)에는 모델을 건드리지 않는다
    await cdp.send("Input.imeSetComposition", { text: "ㅇ", selectionStart: 1, selectionEnd: 1 });
    await cdp.send("Input.imeSetComposition", { text: "이", selectionStart: 1, selectionEnd: 1 });
    assert(textOf((await blocks(page))[0]) === "앞한글", "조합 중 모델 그대로");
    await cdp.send("Input.insertText", { text: "이" });
    assert(textOf((await blocks(page))[0]) === "앞한글이", "조합 끝 → 반영: " + textOf((await blocks(page))[0]));
    // 이어서 Enter, 일반 입력, 실행 취소
    await page.keyboard.press("Enter");
    await compose(["ㄷ", "다"], "다");
    bl = await blocks(page);
    assert(bl.length === 3 && textOf(bl[1]) === "다", "Enter 뒤 조합: " + bl.map(textOf));
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    bl = await blocks(page);
    assert(bl.length === 2 && textOf(bl[0]) === "앞한글이", "Backspace로 빈 문단 합침: " + bl.map(textOf));
    // 여러 문단을 고른 채 조합을 시작하면 먼저 지우고 그 자리에 조합
    await selectText(page, [0, 1], [1, 1]);
    await compose(["ㄴ", "나"], "나");
    bl = await blocks(page);
    assert(bl.length === 1 && textOf(bl[0]) === "앞나", "선택 위 조합: " + bl.map(textOf));
    // 저장되는지
    await waitSaved(page);
    await cdp.detach();
  });

  await test("가장자리: 빈 문단·목록 항목에서 조합 입력, Ctrl+A 후 입력, 그림 뒤 문단 맨 앞 Backspace", async () => {
    await freshDoc(page, projectId, { blocks: [P("a", ""), { id: "l", type: "list", ordered: false, items: [[{ t: "text", text: "항목" }]] }, { id: "f", type: "figure", svg: "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='10'/>", alt: "x" }, P("c", "뒤")] });
    const cdp = await page.context().newCDPSession(page);
    const compose = async (steps, commit) => { for (const s of steps) await cdp.send("Input.imeSetComposition", { text: s, selectionStart: s.length, selectionEnd: s.length }); await cdp.send("Input.insertText", { text: commit }); };
    await page.click("#ed-blocks > .rn-blk-paragraph");
    await compose(["ㄱ", "가"], "가");
    await page.click("#ed-blocks li");
    await page.keyboard.press("End");
    await compose(["ㄴ", "나"], "나");
    let bl = await blocks(page);
    assert(textOf(bl[0]) === "가" && textOf({ content: bl[1].items[0] }) === "항목나", "빈 문단·항목 조합: " + JSON.stringify(bl.slice(0, 2)));
    assert(!(await page.$("#ed-blocks > .rn-blk-paragraph.rn-empty")), "빈 문단 안내 글자 사라짐");
    await cdp.detach();
    // 그림 뒤 문단 맨 앞에서 Backspace → 그림을 고른다(지우지 않음)
    await page.click('#ed-blocks > .rn-blk[data-id="c"]');
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    assert(await page.evaluate(() => document.activeElement.dataset.id === "f"), "그림 고름");
    assert((await blocks(page)).some((b) => b.type === "figure"), "그림은 그대로");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("!");
    assert(textOf((await blocks(page)).find((b) => b.id === "c")) === "!뒤", "↓로 다음 문단 맨 앞");
    // Ctrl+A → 입력하면 전부 바뀜
    await page.keyboard.press("Control+a");
    await page.keyboard.type("새 글");
    bl = await blocks(page);
    assert(bl.length === 1 && textOf(bl[0]) === "새 글", "전체 바꿈: " + JSON.stringify(bl));
  });

  // ---------------- 2차: 문단 안 줄바꿈 ----------------
  let brDocId = null;
  await test("Shift+Enter는 같은 문단 안 줄바꿈({t:'br'}) — 저장·새로고침·내보내기(HTML <br>, MD \\, DOCX <w:br/>)", async () => {
    brDocId = await freshDoc(page, projectId, { blocks: [P("a", ""), P("z", "끝")] }, "줄바꿈");
    await page.click("#ed-blocks > .rn-blk");
    await page.keyboard.type("첫 줄");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("둘째 줄");
    let bl = await blocks(page);
    assert(bl.length === 2 && JSON.stringify(bl[0].content) === JSON.stringify([{ t: "text", text: "첫 줄" }, { t: "br" }, { t: "text", text: "둘째 줄" }]), "br: " + JSON.stringify(bl[0].content));
    assert(await page.$eval("#ed-blocks > .rn-blk", (e) => e.querySelectorAll("br:not(.rn-fill)").length === 1), "화면에 <br>");
    // 줄 끝 Shift+Enter → 빈 둘째 줄이 보이고 그 줄에 커서
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("셋");
    bl = await blocks(page);
    assert(textOf(bl[0]) === "첫 줄⏎둘째 줄⏎셋", "세 줄: " + textOf(bl[0]));
    await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace");
    assert(textOf((await blocks(page))[0]) === "첫 줄⏎둘째 줄", "Backspace로 줄바꿈 지움: " + textOf((await blocks(page))[0]));
    await waitSaved(page);
    const md = await page.evaluate((id) => RN.docs.getDoc(id).then((d) => RN.docs.exportMarkdown(d)), brDocId);
    assert(md.startsWith("첫 줄\\\n둘째 줄\n"), "MD: " + JSON.stringify(md));
    const back = await page.evaluate((md) => RN._test.editor.markdownToBlocks(md)[0].content, md);
    assert(JSON.stringify(back) === JSON.stringify([{ t: "text", text: "첫 줄" }, { t: "br" }, { t: "text", text: "둘째 줄" }]), "MD 왕복: " + JSON.stringify(back));
    const two = await page.evaluate(() => RN._test.editor.markdownToBlocks("가  \n나\n다")[0].content);
    assert(JSON.stringify(two) === JSON.stringify([{ t: "text", text: "가" }, { t: "br" }, { t: "text", text: "나 다" }]), "두 칸 줄바꿈: " + JSON.stringify(two));
    const html = await page.evaluate((id) => RN.docs.getDoc(id).then((d) => RN.docs.exportHtml(d)), brDocId);
    assert(/<p>첫 줄<br>둘째 줄<\/p>/.test(html), "HTML: " + html);
    const docx = await page.evaluate(async (id) => { const d = await RN.docs.getDoc(id); const r = RN._test.editor.documentToDocx(d.title, d.content, d.formatRules); return new TextDecoder().decode(r.bytes); }, brDocId);
    assert(/첫 줄<\/w:t><\/w:r><w:r><w:br\/><\/w:r><w:r><w:t xml:space="preserve">둘째 줄/.test(docx), "DOCX br");
    await page.reload();
    await page.waitForFunction(() => window.RN && RN.docs);
    await page.evaluate(() => RN.ready);
    await openEditor(page, projectId, brDocId);
    assert(textOf((await blocks(page))[0]) === "첫 줄⏎둘째 줄", "새로고침 뒤");
    // br이 없는 예전 문서는 그대로 열린다(위 테스트들의 문서가 그 예)
    await openEditor(page, projectId, docId);
    assert((await firstPara(page).textContent()).includes("자석이"), "예전 문서 열림");
  });

  // ---------------- 2차: DOCX ----------------
  await test("DOCX 내보내기: zip 구조·CRC, document.xml(제목·캡션 번호·참조·표·목록·수식·줄바꿈·굵게), 서식 규칙, 그림", async () => {
    // 래스터 그림(PNG)과 목록·인용·굵게를 더한다
    await page.evaluate(async () => {
      const c = document.createElement("canvas"); c.width = 30; c.height = 20;
      const g = c.getContext("2d"); g.fillStyle = "#c00"; g.fillRect(0, 0, 30, 20);
      await RN.editor.insertFigure({ dataUrl: c.toDataURL("image/png"), caption: "래스터 그림" });
      RN.editor.insertText("## 방법\n\n- 하나\n- 둘\n\n1. 첫째\n2. 둘째\n\n> 인용문\n\n**굵은 글** 과 *기울임*");
    });
    await openPanel(page, "export");
    await page.evaluate(() => { window.__downloads = []; });
    await page.click("#exp-docx");
    await page.waitForFunction(() => window.__downloads.length === 1);
    const dl = await page.evaluate(async () => {
      const d = window.__downloads[0];
      const buf = new Uint8Array(await d.data.arrayBuffer());
      let bin = ""; for (const b of buf) bin += String.fromCharCode(b);
      return { filename: d.filename, type: d.data.type, isBlob: d.data instanceof Blob, b64: btoa(bin) };
    });
    assert(dl.filename === "실험 보고서.docx" && dl.isBlob && /wordprocessingml\.document/.test(dl.type), "파일: " + JSON.stringify([dl.filename, dl.type]));
    const buf = Buffer.from(dl.b64, "base64");
    const files = readZip(buf);
    const names = Object.keys(files);
    for (const n of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels", "word/numbering.xml", "word/footer1.xml"]) assert(names.includes(n), n + " 없음: " + names);
    const media = names.filter((n) => n.startsWith("word/media/"));
    assert(media.length === 1 && media[0].endsWith(".png") && files[media[0]].slice(1, 4).toString() === "PNG", "PNG 그림 하나: " + media);
    const doc = files["word/document.xml"].toString("utf8"), styles = files["word/styles.xml"].toString("utf8"), rels = files["word/_rels/document.xml.rels"].toString("utf8");
    const wf = await page.evaluate((xs) => xs.map((x) => !new DOMParser().parseFromString(x, "application/xml").getElementsByTagName("parsererror").length), [doc, styles, rels, files["[Content_Types].xml"].toString("utf8"), files["word/numbering.xml"].toString("utf8"), files["word/footer1.xml"].toString("utf8")]);
    assert(wf.every(Boolean), "XML이 올바름: " + wf);
    const checks = {
      title: /<w:pStyle w:val="Title"\/><\/w:pPr><w:r><w:t xml:space="preserve">실험 보고서<\/w:t>/.test(doc),
      heading: /<w:pStyle w:val="Heading2"\/><\/w:pPr><w:r><w:t xml:space="preserve">방법</.test(doc),
      caption: /<w:pStyle w:val="Caption"\/><\/w:pPr><w:r><w:t xml:space="preserve">그림 1\. <\/w:t><\/w:r><w:r><w:t xml:space="preserve">첫 그림/.test(doc),
      tableCaption: /표 1\. <\/w:t>/.test(doc),
      rasterCaption: /그림 \d\. <\/w:t><\/w:r><w:r><w:t xml:space="preserve">래스터 그림/.test(doc),
      xref: /결과는 <\/w:t><\/w:r><w:r><w:t xml:space="preserve">그림 2<\/w:t>/.test(doc),
      math: /E=mc\^2/.test(doc) && /\(1\)/.test(doc) && /a\^2\+b\^2/.test(doc),
      table: /<w:tbl>/.test(doc) && /<w:tblHeader\/>/.test(doc),
      list: /<w:numId w:val="1"\/>/.test(doc) && /<w:numId w:val="2"\/>/.test(doc),
      quote: /<w:pStyle w:val="Quote"\/>/.test(doc),
      bold: /<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">굵은 글/.test(doc),
      italic: /<w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">기울임/.test(doc),
      svgNote: /DOCX에는 넣지 못했어요/.test(doc),
      drawing: /<a:blip r:embed="rIdImg1"\/>/.test(doc) && /Target="media\/image1\.png"/.test(rels),
      a4: /<w:pgSz w:w="11906" w:h="16838"\/>/.test(doc),
      margins: /<w:pgMar w:top="1701" w:right="1417" w:bottom="1417" w:left="1417"/.test(doc), // 학술 논문형 30/25/25/25mm
      font: /<w:rFonts w:ascii="Noto Serif KR"/.test(styles),
      size: /<w:sz w:val="20"\/>/.test(styles), // 본문 10pt (학술 논문형 프리셋)
      line: /w:line="384" w:lineRule="auto"/.test(styles), // 160%
      headings: /w:styleId="Heading1"/.test(styles) && /w:styleId="Heading3"/.test(styles) && /w:styleId="Caption"/.test(styles),
      footer: /PAGE/.test(files["word/footer1.xml"].toString("utf8")),
    };
    const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    assert(!bad.length, "document.xml/styles.xml 확인 실패: " + bad.join(", ") + (process.env.DEBUG ? "\n" + doc : ""));
    assert(/SVG|그림/.test(await page.textContent("#exp-docx-note")), "SVG 안내");
    // LibreOffice로 실제로 열리는지 (있을 때만)
    const which = spawnSync("sh", ["-c", "command -v soffice || command -v libreoffice"], { encoding: "utf8" });
    const soffice = (which.stdout || "").trim();
    if (!soffice) { console.log("       (soffice 없음 — 열어 보기 건너뜀)"); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c-docx-"));
    const file = path.join(dir, "report.docx");
    fs.writeFileSync(file, buf);
    const r = spawnSync(soffice, ["--headless", "--norestore", `-env:UserInstallation=file://${dir}/profile`, "--convert-to", "pdf", "--outdir", dir, file], { encoding: "utf8", timeout: 180000 });
    const pdf = path.join(dir, "report.pdf");
    assert(fs.existsSync(pdf) && fs.statSync(pdf).size > 1000, "soffice가 PDF로 바꿈: " + (r.stdout || "") + (r.stderr || ""));
    assert(fs.readFileSync(pdf).slice(0, 5).toString() === "%PDF-", "PDF 머리");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test("DOCX 순수 함수: zip CRC32(알려진 값), 빈 문서·가로 용지·쪽 번호 없음", async () => {
    const r = await page.evaluate(() => {
      const T = RN._test.editor;
      const crc = T.crc32(new TextEncoder().encode("123456789")).toString(16);
      const d = T.documentToDocx("", { blocks: [] }, { page: { size: "B5", orientation: "landscape" }, pageNumber: { enabled: false } });
      let bin = ""; for (const b of d.bytes) bin += String.fromCharCode(b);
      return { crc, b64: btoa(bin) };
    });
    assert(r.crc === "cbf43926", "CRC32: " + r.crc);
    const files = readZip(Buffer.from(r.b64, "base64"));
    assert(files["word/document.xml"] && !files["word/footer1.xml"], "쪽 번호 없으면 꼬리말 없음");
    const doc = files["word/document.xml"].toString();
    assert(/<w:pgSz w:w="14570" w:h="10318" w:orient="landscape"\/>/.test(doc), "B5 가로: " + /<w:pgSz[^>]*>/.exec(doc));
  });

  await test("RN.docs.createDoc: markdown·text·IMPORT 스냅샷, listDocs/listProjects, exportDocx", async () => {
    const r = await page.evaluate(async (pid) => {
      const md = "# 제목\n\n본문 **굵게** 와 $x^2$\n\n- 하나\n- 둘\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> 인용\n\n<script>x</script>";
      const id1 = await RN.docs.createDoc(pid, { title: "가져온 문서", markdown: md, reason: "IMPORT", sourceName: "a.md" });
      const id2 = await RN.docs.createDoc(pid, { title: "텍스트", text: "첫 문단\n이어짐\n\n둘째 문단" });
      const d1 = await RN.docs.getDoc(id1), d2 = await RN.docs.getDoc(id2);
      const docs = await RN.docs.listDocs(pid), projects = await RN.docs.listProjects();
      const snaps = await RN.userColl("docs").doc(id1).collection("snapshots").get();
      const blob = RN.docs.exportDocx(d1);
      return { t1: d1.content.blocks.map((b) => b.type), last: d1.content.blocks[d1.content.blocks.length - 1], t2: d2.content.blocks.map((b) => b.content.map((n) => n.text).join("")), n: docs.length, p: projects.map((p) => p.id), snaps: snaps.docs.map((s) => s.data().reason), md: RN.docs.exportMarkdown(d1), docx: blob instanceof Blob && blob.size > 1000 };
    }, projectId);
    assert(JSON.stringify(r.t1) === JSON.stringify(["heading", "paragraph", "list", "table", "quote", "paragraph"]), "md 블록: " + r.t1);
    assert(r.last.content[0].text === "<script>x</script>", "원시 HTML은 텍스트");
    assert(JSON.stringify(r.t2) === JSON.stringify(["첫 문단 이어짐", "둘째 문단"]), "text 문단: " + r.t2);
    assert(r.n >= 3 && r.p.includes(projectId), "목록");
    assert(JSON.stringify(r.snaps) === '["IMPORT"]', "IMPORT 스냅샷");
    assert(/\*\*굵게\*\*/.test(r.md) && /\$x\^2\$/.test(r.md), "md 왕복");
    assert(r.docx, "exportDocx Blob");
  });

  await test("프로젝트 홈: 섹션은 탭 하나씩(이름 기본값), 처음 열 때 mount, 설정 탭에 정보 수정", async () => {
    await page.evaluate(() => {
      window.__mounted = [];
      RN.projectSections.push({ id: "zz-test", mount(box, p) { window.__mounted.push(p.id); box.append(document.createTextNode("시험 섹션")); return () => window.__mounted.push("off"); } });
    });
    await go(page, "project", { id: projectId });
    await page.waitForSelector("#ptab-docs[aria-selected=true]");
    const labels = await page.$$eval("#rn-view [role=tab]", (els) => els.map((e) => e.textContent));
    for (const [id, label] of [["pains", "고충"], ["data", "데이터"], ["research", "연구 공개"], ["import", "가져오기"]]) {
      const sec = await page.evaluate((id) => { const s = RN.projectSections.find((x) => x.id === id); return s ? { label: s.label || null } : null; }, id);
      if (sec) assert(labels.includes(sec.label || label), `${id} 탭 이름 ${sec.label || label}: ${labels}`);
    }
    assert(labels.includes("zz-test"), "label 없으면 id: " + labels);
    assert((await page.evaluate(() => window.__mounted.length)) === 0, "아직 mount 안 함");
    assert(await page.isHidden('[data-section="zz-test"]'), "섹션 숨김");
    await page.click("#ptab-s-zz-test");
    await page.waitForFunction(() => window.__mounted.length === 1);
    assert(/시험 섹션/.test(await page.textContent('[data-section="zz-test"]')), "섹션 내용");
    await page.click("#ptab-docs");
    await page.click("#ptab-s-zz-test");
    assert((await page.evaluate(() => window.__mounted.length)) === 1, "한 번만 mount");
    // 키보드로 탭 이동
    await page.focus("#ptab-docs");
    await page.keyboard.press("End");
    assert(await page.evaluate(() => document.activeElement.id === "ptab-settings" && document.activeElement.getAttribute("aria-selected") === "true"), "End → 설정");
    await page.fill("#pe-desc", "렌츠 법칙 실험 (수정)");
    await page.click("#proj-save");
    await page.waitForFunction(() => /수정\)/.test(document.querySelector(".rn-proj-intro").textContent));
    await go(page, "projects");
    assert((await page.evaluate(() => window.__mounted)).includes("off"), "떠날 때 정리 함수");
    await page.evaluate(() => { RN.projectSections.splice(RN.projectSections.findIndex((s) => s.id === "zz-test"), 1); });
  });

  await test("다른 사용자(?user=u2)에게 내 프로젝트·문서가 안 보인다", async () => {
    const ctx2 = await setupContext();
    const p2 = await newPage(ctx2, "?user=u2");
    const all = await store(page);
    await p2.evaluate((s) => window.__mockDb.seed(s), all);
    await go(p2, "projects");
    await p2.waitForSelector("#proj-tab-archived");
    assert(!(await p2.textContent("#rn-view")).includes("구리관 자석 낙하"), "목록에 없음");
    await go(p2, "project", { id: projectId });
    await p2.waitForFunction(() => document.querySelector("h1").textContent === "프로젝트를 찾을 수 없어요");
    await go(p2, "editor", { projectId, docId });
    await p2.waitForFunction(() => document.querySelector("h1").textContent === "문서를 찾을 수 없어요");
    assert((await p2.evaluate((id) => RN.docs.getDoc(id), docId)) === null, "getDoc null");
    const p3 = await newPage(ctx2, "?anon=1");
    await go(p3, "projects");
    await p3.waitForFunction(() => /로그인하면/.test(document.querySelector("#rn-view").textContent));
    await ctx2.close();
  });

  await test("휴지통: 설정 탭에서 삭제 → 하위 문서도 같은 시각 → 목록 아래 '휴지통' 링크에서 복구, 30일 지난 것은 영구 삭제", async () => {
    await go(page, "project", { id: projectId });
    await page.click("#ptab-settings");
    await page.click("#proj-delete");
    await page.click("dialog button:has-text('휴지통으로')");
    await page.waitForFunction(() => RN.current.name === "projects");
    let s = await store(page);
    const pAt = s[`data/users/u1/projects/items/${projectId}`].deletedAt;
    const docs = Object.entries(s).filter(([k, v]) => k.startsWith("data/users/u1/docs/items/") && k.split("/").length === 6 && v.projectId === projectId);
    assert(pAt && docs.length >= 3 && docs.every(([, v]) => v.deletedAt === pAt), "문서도 같은 시각");
    await page.click("#proj-tab-trash");
    await page.waitForSelector(`[data-project-id="${projectId}"]`);
    assert(/30일 뒤 영구 삭제/.test(await page.textContent(`[data-project-id="${projectId}"]`)), "남은 일수");
    await page.click(`[data-project-id="${projectId}"] button:has-text('복구')`);
    await page.waitForFunction((id) => !document.querySelector(`[data-project-id="${id}"]`), projectId);
    s = await store(page);
    assert(!s[`data/users/u1/projects/items/${projectId}`].deletedAt, "프로젝트 복구");
    assert(Object.entries(s).filter(([k, v]) => k.startsWith("data/users/u1/docs/items/") && v.projectId === projectId).every(([, v]) => !v.deletedAt), "문서 복구");
    await page.click("#proj-tab-active");
    await page.waitForSelector(`[data-project-id="${projectId}"]`);
    const old = Date.now() - 31 * 86400000;
    await page.evaluate((old) => window.__mockDb.seed({
      "data/users/u1/projects/items/oldp": { title: "옛 프로젝트", description: "", field: "", keywords: [], archivedAt: null, deletedAt: old, createdAt: 1, updatedAt: 1 },
      "data/users/u1/docs/items/oldd": { projectId: "oldp", title: "옛 문서", content: { blocks: [] }, formatRules: null, version: 1, deletedAt: old, updatedAt: 1 },
      "data/users/u1/docs/items/oldd/snapshots/s1": { content: { blocks: [] }, version: 1, reason: "AUTO", createdAt: 1 },
    }), old);
    await go(page, "home"); await go(page, "projects");
    await page.waitForFunction(() => !JSON.parse(localStorage.getItem("renote-mock-db"))["data/users/u1/projects/items/oldp"]);
    s = await store(page);
    assert(!s["data/users/u1/docs/items/oldd"] && !s["data/users/u1/docs/items/oldd/snapshots/s1"], "하위 문서·스냅샷도 영구 삭제");
    // 보관
    await go(page, "project", { id: projectId });
    await page.click("#ptab-settings");
    await page.click("#proj-archive");
    await page.waitForFunction(() => document.querySelector("#proj-archive").textContent === "보관 해제");
    await go(page, "projects");
    await page.click("#proj-tab-archived");
    await page.waitForSelector(`[data-project-id="${projectId}"]`);
  });

  await test("순수 함수: 번호 계산(수식 캡션 공유, 표 위 캡션), 참조 입력 파싱, 글꼴 대체, 줄 모델", async () => {
    const r = await page.evaluate(() => {
      const T = RN._test.editor;
      const doc = { blocks: [
        { id: "c0", type: "caption", kind: "table", content: [{ t: "text", text: "위 캡션" }] },
        { id: "t", type: "table", rows: [["a"]] },
        { id: "m1", type: "math", latex: "a" },
        { id: "mc", type: "caption", kind: "equation", content: [{ t: "text", text: "운동 방정식" }] },
        { id: "m2", type: "math", latex: "b" },
        { id: "f", type: "figure", svg: "<svg/>" }, { id: "fc", type: "caption", kind: "figure", content: [] },
      ] };
      const n = T.computeNumbering(doc);
      // 줄 모델: 목록 가운데 항목을 문단으로 → 목록이 둘로 나뉘고 id가 겹치지 않는다
      const L = T.flattenBlocks([{ id: "L", type: "list", ordered: true, items: [[{ t: "text", text: "a" }], [{ t: "text", text: "b" }], [{ t: "text", text: "c" }]] }]);
      T.linesSetType(L, { line: 1, off: 0 }, { line: 1, off: 0 }, "list", true, true);
      const split = T.unflattenLines(L);
      return {
        labels: n.entries.map((e) => e.refLabel), mc: n.byId.get("mc").refLabel, t: n.byId.get("t").refLabel, f: n.byId.get("f").captionLabel,
        trig: [T.parseRefTrigger("결과는 @그림"), T.parseRefTrigger("a@b"), T.parseRefTrigger("(@표1")],
        font: [T.resolveFont("함초롬바탕"), T.resolveFont("나눔고딕"), T.resolveFont("Noto Serif KR"), T.resolveFont("이상한명조")],
        norm: T.normalizeRules({ body: { font: "바탕", sizePt: 99 } }),
        split: split.map((b) => b.type + ":" + b.id), ids: new Set(split.map((b) => b.id)).size,
      };
    });
    assert(JSON.stringify(r.labels) === JSON.stringify(["표 1", "식 (1)", "식 (2)", "그림 1"]), "번호: " + r.labels);
    assert(r.mc === "식 (1)" && r.t === "표 1" && r.f === "그림 1.", "byId");
    assert(r.trig[0].query === "그림" && r.trig[1] === null && r.trig[2].query === "표1", "트리거");
    assert(r.font[0].font === "noto-serif-kr" && r.font[0].substituted && r.font[1].font === "noto-sans-kr" && !r.font[2].substituted && r.font[3].font === "noto-serif-kr", "글꼴");
    assert(r.norm.rules.body.font === "noto-serif-kr" && r.norm.rules.headings.h1.font === "noto-serif-kr" && r.norm.rules.body.sizePt === 11 && r.norm.fontNotices.length === 1 && r.norm.defaulted.includes("body.sizePt"), "normalizeRules");
    assert(r.split.length === 3 && r.split[0] === "list:L" && /^paragraph:/.test(r.split[1]) && /^list:/.test(r.split[2]) && r.ids === 3, "목록 나누기: " + r.split);
  });

  await test("휴대폰 폭(400px)에서 에디터·프로젝트 화면 가로 스크롤 없음, 삽입 메뉴가 화면 안", async () => {
    const ctx3 = await setupContext({ width: 400, height: 800 });
    const p = await newPage(ctx3);
    await p.evaluate((s) => window.__mockDb.seed(s), await store(page));
    await openEditor(p, projectId, docId);
    let sw = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert(sw[0] <= sw[1], "에디터 scrollWidth " + sw);
    await p.click("#tb-insert");
    const r = await p.$eval("#tb-insert-menu", (e) => { const b = e.getBoundingClientRect(); return [b.left, b.right, window.innerWidth]; });
    assert(r[0] >= 0 && r[1] <= r[2], "메뉴가 화면 안: " + r);
    sw = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert(sw[0] <= sw[1], "메뉴 연 채 scrollWidth " + sw);
    await p.keyboard.press("Escape");
    await p.click("#edtab-format");
    sw = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert(sw[0] <= sw[1], "패널 연 채 scrollWidth " + sw);
    await go(p, "project", { id: projectId });
    await p.waitForSelector("#ptab-docs");
    sw = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert(sw[0] <= sw[1], "프로젝트 화면 scrollWidth " + sw);
    await ctx3.close();
  });

  await test("mod-editor.js에서 난 오류 없음", async () => { assert(!errors.length, errors.join("\n")); });

  await browser.close();
  server.kill();
  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
  if (failed) { console.log("실패: " + failures.join(", ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
