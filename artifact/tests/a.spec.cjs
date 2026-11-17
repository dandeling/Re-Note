/* 담당 A 테스트: 검색·의미 검색·탐색·연구 상세·공개 흐름(결과보고서 PDF)·챗봇·비로그인. 실행: node tests/a.spec.cjs (포트 4101)
   외부 요청은 막고, KaTeX·PapaParse는 로컬 node_modules에서 대신 준다(아티팩트 환경 흉내).
   pdf.js(cdnjs 3.11.174)는 기본으로 막아 "미리보기를 열 수 없어요" 경로를 확인한다. node_modules/pdfjs-dist/build(또는 PDFJS_DIR)에
   pdf.min.js·pdf.worker.min.js가 있으면 그 파일로 렌더링 경로도 확인한다. */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const PORT = 4101;
const BASE = `http://localhost:${PORT}/dev.html`;
const ROOT = path.join(__dirname, "..");
const NM = path.join(ROOT, "..", "node_modules");
const MY_FILES = /mod-(search|home|research|chat)\.js/;
const PDFJS_DIR = process.env.PDFJS_DIR || path.join(NM, "pdfjs-dist/build");
const HAS_PDFJS = fs.existsSync(path.join(PDFJS_DIR, "pdf.min.js")) && fs.existsSync(path.join(PDFJS_DIR, "pdf.worker.min.js"));

/** 글꼴 없이 사각형만 그린 n쪽짜리 PDF */
function makePdf(pages) {
  const objs = { 1: "<< /Type /Catalog /Pages 2 0 R >>" };
  const kids = [];
  let n = 3;
  for (let i = 0; i < pages; i++) {
    const pg = n++, ct = n++;
    kids.push(pg + " 0 R");
    const stream = `0 0 1 rg ${40 + i * 30} 60 150 150 re f`;
    objs[pg] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents ${ct} 0 R >>`;
    objs[ct] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objs[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;
  let out = "%PDF-1.4\n";
  const offs = [];
  for (let i = 1; i < n; i++) { offs[i] = Buffer.byteLength(out); out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${n}\n0000000000 65535 f \n` + offs.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const PDF2 = makePdf(2);

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; failures.push(name); console.log("  FAIL " + name + "\n       " + String((e && e.stack) || e).split("\n").slice(0, 4).join("\n       ")); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

const EXTRA = {
  // 연구가 없는 주제의 고충 (관련 고충만 있는 경우)
  "pains/t-pain-only": { title: "초전도 자석을 액체질소로 냉각하는 시간이 너무 길어요", body: "초전도체 마이스너 효과 실험에서 냉각이 오래 걸립니다.", stage: "EXPERIMENT", field: "물리", tags: ["초전도", "마이스너 효과"], isAnonymous: false, authorId: "u2", researchId: null, resolved: false, resolution: null, createdAt: 1, updatedAt: 1, meTooCount: 0, commentCount: 0 },
  // 익명 고충: 연구 상세 목록에 나오면 안 된다
  "pains/t-anon": { title: "익명으로 남긴 음향 블랙홀 고민", body: "익명 본문", stage: "OTHER", field: "물리", tags: ["음향 블랙홀"], isAnonymous: true, authorId: null, researchId: "seed-r01", resolved: false, resolution: null, createdAt: 2, updatedAt: 2, meTooCount: 0, commentCount: 0 },
  // 결과보고서가 있는 u1의 연구 (위험한 HTML이 섞여 있다)
  "research/t-rep": { title: "광합성 색소 분리 크로마토그래피 비교", summary: "종이 크로마토그래피와 TLC로 시금치 색소를 분리해 Rf 값을 비교했다.", field: "생명", keywords: ["크로마토그래피", "광합성 색소"], limitations: "용매 비율을 두 가지만 시험했다.", authorId: "u1", publishedAt: 1790000000000, isExample: false,
    report: { title: "색소 분리 결과보고서", html: '<h1>결과</h1><p>Rf 값 표</p><table><tr><th>색소</th><th>Rf</th></tr><tr><td>엽록소 a</td><td>0.45</td></tr></table><script>window.__xss=1</script><img src="x" onerror="window.__xss=2"><p style="color:red" onclick="window.__xss=3">끝</p>' } },
  // 개인 프로젝트 (publish 흐름용)
  "data/users/u1/projects/items/p1": { title: "자석 낙하 실험", description: "구리관 속 자석 낙하 시간 측정", field: "물리", keywords: ["렌츠 법칙", "맴돌이 전류"], archivedAt: null, deletedAt: null, createdAt: 1, updatedAt: 1 },
};

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, "dev-server.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((res, rej) => { server.stdout.once("data", res); server.once("error", rej); setTimeout(res, 3000); });
  const browser = await chromium.launch();
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "dev-seed.json"), "utf8"));
  const errors = [];

  async function newPage(query = "", viewport, opts = {}) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1100, height: 900 } });
    const page = await ctx.newPage();
    page.__pdfjsRequests = [];
    await page.route(/^https?:\/\/(?!localhost)/, (route) => {
      const u = route.request().url();
      if (/pdf\.js\/3\.11\.174\//.test(u)) {
        page.__pdfjsRequests.push(u);
        if (opts.pdfjs && HAS_PDFJS) return route.fulfill({ path: path.join(PDFJS_DIR, u.endsWith("pdf.worker.min.js") ? "pdf.worker.min.js" : "pdf.min.js"), contentType: "text/javascript" });
        return route.abort();
      }
      if (u.includes("katex.min.js") && fs.existsSync(path.join(NM, "katex/dist/katex.min.js"))) return route.fulfill({ path: path.join(NM, "katex/dist/katex.min.js"), contentType: "text/javascript" });
      if (u.includes("papaparse.min.js") && fs.existsSync(path.join(NM, "papaparse/papaparse.min.js"))) return route.fulfill({ path: path.join(NM, "papaparse/papaparse.min.js"), contentType: "text/javascript" });
      return route.abort();
    });
    page.on("pageerror", (e) => { const s = String(e.stack || e); if (MY_FILES.test(s)) errors.push(s); });
    page.on("console", (m) => { if (m.type() === "error" && MY_FILES.test(m.text() + JSON.stringify(m.location()))) errors.push(m.text()); });
    // 씨앗 데이터: 먼저 한 번 열어 localStorage에 넣고 다시 연다
    await page.goto(BASE + query);
    await page.evaluate(([s, extra]) => { window.__mockDb.reset(); window.__mockDb.seed({ ...s, ...extra }); }, [seed, EXTRA]);
    await page.goto("about:blank");
    await page.goto(BASE + query);
    await page.waitForFunction(() => window.RN && RN.shared.loaded.research && RN.shared.loaded.pains);
    return page;
  }
  const go = (page, name, params) => page.evaluate(([n, p]) => RN.go(n, p), [name, params || {}]);

  console.log("담당 A 테스트");
  const page = await newPage();

  await test("RN.search: 띄어쓰기 차이와 한 글자 오타를 찾고, 관련 없는 질의는 빈 결과", async () => {
    const r = await page.evaluate(() => ({
      joined: RN.search("음향블랙홀").research.map((x) => x.id),
      spaced: RN.search("음향 블랙홀").research.map((x) => x.id),
      typo: RN.search("음향 블럑홀").research.map((x) => x.id),
      typo2: RN.search("진동 감쇄").research.map((x) => x.id),
      none: RN.search("양자 컴퓨터 블록체인"),
      blank: RN.search("   "),
    }));
    assert(r.joined[0] === "seed-r01", "붙여 쓴 검색 " + r.joined);
    assert(r.spaced[0] === "seed-r01", "띄어 쓴 검색 " + r.spaced);
    assert(r.typo.includes("seed-r01"), "오타 검색 " + r.typo);
    assert(r.typo2.includes("seed-r01"), "오타 검색2 " + r.typo2);
    assert(r.none.research.length === 0 && r.none.pains.length === 0, "관련 없는 질의가 결과를 냄");
    assert(r.blank.research.length === 0, "빈 질의");
  });

  await test("RN.search: 익명 고충에 작성자·연결 연구가 없다", async () => {
    const hit = await page.evaluate(() => RN.search("익명으로 남긴 음향 블랙홀 고민").pains.find((p) => p.id === "t-anon"));
    assert(hit, "익명 고충이 검색되지 않음");
    assert(!("authorId" in hit) && hit.researchId === null, "작성자/연구 노출: " + JSON.stringify(hit));
    const anyAuthor = await page.evaluate(() => RN.search("음향 블랙홀").pains.some((p) => "authorId" in p));
    assert(!anyAuthor, "고충 결과에 authorId");
  });

  await test("RN.search: 1000건에서 한 번 검색이 빠르다", async () => {
    const ms = await page.evaluate(() => {
      const keep = { r: RN.shared.research, p: RN.shared.pains };
      const big = [], bp = [];
      for (let i = 0; i < 1000; i++) { const r = keep.r[i % keep.r.length]; big.push({ ...r, id: "big" + i, title: r.title + " " + i }); }
      for (let i = 0; i < 1000; i++) { const p = keep.p[i % keep.p.length]; bp.push({ ...p, id: "bigp" + i }); }
      RN.shared.research = big; RN.shared.pains = bp;
      let t = performance.now(); RN.search("워밍업"); const first = performance.now() - t;
      t = performance.now(); RN.search("음향 블랙홀 진동 감쇠"); const one = performance.now() - t;
      RN.shared.research = keep.r; RN.shared.pains = keep.p;
      return { first, one };
    });
    console.log("       (색인+검색 " + ms.first.toFixed(0) + "ms, 검색 " + ms.one.toFixed(0) + "ms)");
    assert(ms.one < 150, "검색이 느림: " + ms.one);
  });

  await test("RN.searchExpanded: 주어진 표현으로 찾은 결과를 합치고(최고 점수, 원래 검색어 가중), 문자열 아닌 것·긴 것은 버린다", async () => {
    const r = await page.evaluate(() => {
      const plain = RN.search("판 떨림 줄이기", { limit: 20 });
      const ex = RN.searchExpanded("판 떨림 줄이기", ["음향 블랙홀", "진동 감쇠", 42, { title: "가짜 연구" }, "가".repeat(40), "음향 블랙홀", "판 떨림 줄이기", null], { limit: 20 });
      const same = RN.searchExpanded("음향 블랙홀", ["진동 감쇠"], { limit: 20 });
      const base = RN.search("음향 블랙홀", { limit: 20 });
      const ids = new Set((RN.shared.research || []).map((x) => x.id).concat((RN.shared.pains || []).map((x) => x.id)));
      return {
        plainIds: plain.research.map((x) => x.id), exIds: ex.research.map((x) => x.id), terms: ex.terms, used: ex.usedTerms,
        r01: ex.research.find((x) => x.id === "seed-r01"),
        allFromSite: [...ex.research, ...ex.pains].every((x) => ids.has(x.id)),
        sorted: ex.research.every((x, i, a) => !i || a[i - 1].score >= x.score),
        unique: new Set(ex.research.map((x) => x.id)).size === ex.research.length,
        sameTop: same.research[0] && same.research[0].id, sameScore: same.research[0] && same.research[0].score, baseScore: base.research[0] && base.research[0].score,
        sameVia: same.research[0] && same.research[0].matchedBy,
        clean: RN.searchUtil.cleanTerms({ terms: ["a"] }, "x"), clean2: RN.searchUtil.cleanTerms(Array.from({ length: 20 }, (_, i) => "표현" + i), "x").length,
      };
    });
    assert(!r.plainIds.includes("seed-r01"), "원래 검색어만으로 이미 찾음: " + r.plainIds);
    assert(r.exIds.includes("seed-r01"), "표현으로 찾지 못함 " + r.exIds);
    assert(JSON.stringify(r.terms) === JSON.stringify(["음향 블랙홀", "진동 감쇠"]), "표현 정리 " + JSON.stringify(r.terms));
    assert(r.r01.score <= 0.85 && r.r01.matchedBy, "다른 표현 결과에 가중치 " + JSON.stringify(r.r01));
    assert(r.allFromSite && r.sorted && r.unique, "결과 형식 " + JSON.stringify(r));
    assert(r.sameTop === "seed-r01" && r.sameScore === r.baseScore && r.sameVia === null, "원래 검색어 결과는 점수 그대로 " + JSON.stringify(r));
    assert(r.clean.length === 0 && r.clean2 === 8, "배열이 아니면 버리고 8개까지 " + JSON.stringify(r));
  });

  await test("home: 제목·검색창·바로 가기 3개뿐, 제출 → explore 결과(카드는 메타 한 줄)", async () => {
    await go(page, "home");
    const home = await page.evaluate(() => ({
      links: [...document.querySelectorAll("main .home-links a")].map((a) => a.querySelector("b").textContent),
      cards: document.querySelectorAll("main .rn-card").length, text: document.querySelector("main").textContent,
    }));
    assert(JSON.stringify(home.links) === JSON.stringify(["연구 탐색", "고충 게시판", "내 프로젝트"]), "링크 " + home.links);
    assert(home.cards === 0 && !home.text.includes("최근 공개된 연구"), "카드/최근 목록이 남아 있음");
    assert(page.__pdfjsRequests.length === 0, "첫 화면에서 pdf.js를 불러옴");
    await page.fill("#home-q", "음향블랙홀");
    await page.press("#home-q", "Enter");
    await page.waitForSelector('#explore-results [data-research-id="seed-r01"]');
    assert((await page.inputValue("#explore-q")) === "음향블랙홀");
    const card = await page.$eval('#explore-results [data-research-id="seed-r01"]', (el) => ({
      text: el.textContent, meta: el.querySelector(".rs-meta").textContent, badges: el.querySelectorAll(".rn-badge").length,
      ex: (el.querySelector(".rs-ex") || {}).textContent, limit: el.textContent.includes("한계"), clamp: getComputedStyle(el.querySelector(".rs-summary")).webkitLineClamp,
    }));
    assert(/^물리 · 고충 \d+건/.test(card.meta) && (card.meta.match(/#/g) || []).length <= 3, "메타 한 줄 " + card.meta);
    assert(card.badges === 0 && !/유사도/.test(card.text) && !card.limit, "배지·유사도·한계가 카드에 있음 " + card.text);
    assert(card.ex === "예시" && card.clamp === "2", "예시 표시/요약 두 줄 " + JSON.stringify(card));
  });

  await test("explore: 검색어가 없으면 최근 공개된 연구", async () => {
    await go(page, "explore");
    await page.waitForSelector("#explore-results [data-research-id]");
    assert((await page.textContent("#explore-results h2")).includes("최근 공개된 연구"));
  });

  await test("explore '의미로 더 찾기': 누를 때만 AI(quick)에 묻고, 받은 검색어로 사이트 안에서만 찾는다", async () => {
    await page.evaluate(() => {
      window.__calls = [];
      window.__mockSample = async (text, opts) => {
        window.__calls.push({ text, tier: opts.modelTier });
        return JSON.stringify(["음향 블랙홀", "진동 감쇠", { title: "AI가 지어낸 연구", id: "fake" }, "x".repeat(80)]);
      };
    });
    await go(page, "explore", { q: "판 떨림 줄이기" });
    await page.waitForSelector("#explore-empty");
    assert((await page.evaluate(() => window.__calls.length)) === 0, "자동으로 AI를 부름");
    const before = await page.evaluate(() => (window.__mockDb.store["data/users/u1/aiUsage"] || { count: 0 }).count);
    await page.click("#explore-expand");
    await page.waitForSelector("#explore-terms");
    const r = await page.evaluate(() => ({
      terms: document.getElementById("explore-terms").textContent, call: window.__calls[0], n: window.__calls.length,
      r01: !!document.querySelector('#explore-results [data-research-id="seed-r01"]'),
      fake: document.getElementById("explore-results").textContent.includes("지어낸"),
      usage: (window.__mockDb.store["data/users/u1/aiUsage"] || {}).count,
    }));
    assert(r.n === 1 && r.call.tier === "quick" && r.call.text.includes("판 떨림 줄이기"), "AI 호출 " + JSON.stringify(r.call));
    assert(r.terms.includes("이런 표현으로도 찾았어요") && r.terms.includes("음향 블랙홀") && !r.terms.includes("xxxx"), "표현 줄 " + r.terms);
    assert(r.r01 && !r.fake, "결과 " + JSON.stringify(r));
    assert(r.usage === before + 1, "일일 한도에 포함 " + before + "→" + r.usage);
    // 새 검색어로 검색하면 표현 줄이 사라진다
    await page.fill("#explore-q", "음향 블랙홀");
    await page.press("#explore-q", "Enter");
    await page.waitForFunction(() => !document.getElementById("explore-terms"));
    // 쓸 수 없는 응답이면 결과를 바꾸지 않고 알린다
    await page.evaluate(() => { window.__mockSample = async () => '{"answer": "관련 연구: 가짜"}'; });
    await page.click("#explore-expand");
    await page.waitForFunction(() => /관련 표현을 받지 못했어요/.test(document.getElementById("rn-toast").textContent));
    assert(!(await page.$("#explore-terms")), "잘못된 응답으로 표현 줄");
    // 한도를 넘으면 묻지 않는다
    await page.evaluate(() => { RN.aiDailyLimit = 0; window.__calls = []; window.__mockSample = async () => { window.__calls.push(1); return "[]"; }; });
    await page.click("#explore-expand");
    await page.waitForFunction(() => /모두 썼어요/.test(document.getElementById("rn-toast").textContent));
    assert((await page.evaluate(() => window.__calls.length)) === 0, "한도 초과인데 호출함");
    await page.evaluate(() => { RN.aiDailyLimit = undefined; });
  });

  await test("explore: 결과 없음을 분명히 표시, 관련 고충만 있으면 따로 노출", async () => {
    await page.fill("#explore-q", "양자 컴퓨터");
    await page.press("#explore-q", "Enter");
    await page.waitForSelector("#explore-empty");
    assert((await page.textContent("#explore-empty")).includes("아직 이 사이트에 등록된 연구가 없어요"));
    assert((await page.$$("#explore-results [data-research-id]")).length === 0, "연구 카드가 있음");
    await page.fill("#explore-q", "초전도");
    await page.press("#explore-q", "Enter");
    await page.waitForSelector('#explore-pains [data-pain-id="t-pain-only"]');
    assert(await page.$("#explore-empty"), "연구 없음 안내가 없음");
  });

  await test("research 상세: 요약 → 한계 → 결과보고서 → 연결된 고충(익명 제외) → 비슷한 연구, 구역을 카드로 감싸지 않음", async () => {
    await go(page, "research", { id: "seed-r01" });
    await page.waitForSelector("#research-summary");
    const order = await page.evaluate(() => {
      const ids = ["research-summary", "research-limitations", "research-report", "research-pains", "research-similar"];
      const els = ids.map((i) => document.getElementById(i));
      return { ordered: els.every((el, i) => !i || (els[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)), cards: document.querySelectorAll("main section.rn-card, main .rn-card .rn-card").length };
    });
    assert(order.ordered && order.cards === 0, "순서/카드 " + JSON.stringify(order));
    const t = await page.textContent("main");
    assert(t.includes("음향 블랙홀 구조를 이용한"), "제목");
    assert((await page.textContent("#research-limitations")).includes("0.3 mm"), "한계");
    const pains = await page.textContent("#research-pains");
    assert(pains.includes("CNC로 깎으면"), "연결된 고충이 없음");
    assert(!pains.includes("익명으로 남긴"), "익명 고충이 보임");
    assert(await page.$("#research-similar"), "비슷한 연구 섹션");
    assert((await page.textContent("#research-report")).includes("등록된 결과보고서가 없어요"));
    assert(!(await page.$("#research-delete")), "예시 연구에 삭제 버튼");
  });

  await test("research 상세: 결과보고서를 흰 종이에 안전하게 표시하고 HTML로 저장", async () => {
    await go(page, "research", { id: "t-rep" });
    await page.waitForSelector("#research-report-paper table");
    const info = await page.evaluate(() => {
      const p = document.getElementById("research-report-paper");
      return { scripts: p.querySelectorAll("script, img, [onclick], [onerror]").length, xss: window.__xss, bg: getComputedStyle(p).backgroundColor, text: p.textContent };
    });
    assert(info.scripts === 0 && info.xss === undefined, "위험 요소가 남음 " + JSON.stringify(info));
    assert(info.bg === "rgb(255, 255, 255)", "종이 배경 " + info.bg);
    assert(info.text.includes("엽록소 a"), "보고서 본문");
    await page.click("#research-report-save");
    await page.waitForFunction(() => (window.__downloads || []).length > 0);
    const dl = await page.evaluate(() => window.__downloads[0]);
    assert(/\.html$/.test(dl.filename) && dl.data.includes("엽록소 a") && dl.data.startsWith("<!doctype html>"), "저장 파일 " + dl.filename);
    assert(await page.$("#research-delete"), "작성자에게 삭제 버튼이 없음");
  });

  await test("publish: 요약·키워드·한계 + 문서 선택 → 확인 → research 생성 → 상세 → 작성자 삭제", async () => {
    // 에디터 모듈이 없으면 RN.docs를 흉내 낸다
    await page.evaluate(() => {
      if (!RN.docs) RN.docs = {
        listProjects: async () => [{ id: "p1", title: "자석 낙하 실험", description: "구리관 속 자석 낙하 시간 측정", field: "물리", keywords: ["렌츠 법칙", "맴돌이 전류"] }],
        listDocs: async () => [{ id: "d1", title: "최종 보고서" }],
        getDoc: async () => ({ id: "d1", title: "최종 보고서", content: {} }),
        exportHtml: () => "<h1>최종 보고서</h1><p>낙하 시간이 길어졌다.</p>",
      };
      window.__fakeDocs = !RN.docs.__real;
    });
    await go(page, "publish", { projectId: "p1" });
    await page.waitForSelector("#publish-form");
    assert((await page.inputValue("#pub-title")) === "자석 낙하 실험", "제목 미리 채움");
    const ui = await page.evaluate(() => ({ forms: document.querySelectorAll("main form").length, primary: [...document.querySelectorAll("main .rn-primary")].map((b) => b.textContent), pdf: !!document.getElementById("pub-report-kind-pdf") }));
    assert(ui.forms === 1 && JSON.stringify(ui.primary) === '["공개"]' && ui.pdf, "폼 하나·주 버튼 '공개' 하나 " + JSON.stringify(ui));
    await page.fill("#pub-summary", "구리관에서 자석이 천천히 떨어지는 시간을 측정했다.");
    await page.fill("#pub-keywords", "렌츠 법칙, 맴돌이 전류, 자석 낙하");
    await page.fill("#pub-limitations", "관 길이를 하나만 썼다.");
    const docEnabled = await page.$eval("#pub-report-kind-doc", (el) => !el.disabled);
    const opts = docEnabled ? await page.$$eval("#pub-report option", (os) => os.map((o) => o.value)) : [];
    if (opts.length) { await page.check("#pub-report-kind-doc"); await page.selectOption("#pub-report", opts[0]); }
    else await page.check("#pub-report-kind-none");
    await page.click("#pub-submit");
    await page.waitForSelector("dialog.rn-dialog[open]");
    await page.click("dialog.rn-dialog[open] .rn-primary");
    await page.waitForSelector("#research-summary");
    assert((await page.textContent("h1")) === "자석 낙하 실험", "상세로 이동");
    const created = await page.evaluate(() => Object.entries(window.__mockDb.store).find(([k, v]) => k.startsWith("research/") && v.title === "자석 낙하 실험"));
    assert(created && created[1].authorId === "u1" && created[1].keywords.length === 3 && typeof created[1].publishedAt === "number", "문서 형식 " + JSON.stringify(created));
    if (opts.length) { assert(created[1].report && created[1].report.html.length > 0, "보고서 없음"); await page.waitForSelector("#research-report-paper"); }
    assert(created[1].reportAsset == null, "문서 보고서인데 reportAsset " + JSON.stringify(created[1].reportAsset));
    // 검색에 바로 잡힌다
    const found = await page.evaluate(() => RN.search("맴돌이전류").research.map((r) => r.title));
    assert(found.includes("자석 낙하 실험"), "공개한 연구가 검색되지 않음 " + found);
    await page.click("#research-delete");
    await page.click("dialog.rn-dialog[open] .rn-danger");
    await page.waitForFunction(() => !Object.values(window.__mockDb.store).some((v) => v && v.title === "자석 낙하 실험" && v.publishedAt));
  });

  async function fillPublish(p, title) {
    await go(p, "publish", { projectId: "p1" });
    await p.waitForSelector("#publish-form");
    await p.fill("#pub-title", title);
    await p.fill("#pub-summary", "PDF 보고서 테스트 요약");
    await p.fill("#pub-keywords", "PDF 테스트");
  }

  await test("publish: PDF가 아니거나 20MB를 넘으면 올리지 않는다", async () => {
    await fillPublish(page, "PDF 거절 테스트");
    await page.check("#pub-report-kind-pdf");
    await page.setInputFiles("#pub-pdf", { name: "가짜.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html>not a pdf</html>") });
    await page.waitForFunction(() => /PDF 파일이 아니에요/.test(document.getElementById("pub-pdf-note").textContent));
    await page.click("#pub-submit");
    await page.waitForFunction(() => /PDF 파일이 아니에요/.test(document.getElementById("pub-status").textContent));
    const big = Buffer.alloc(20 * 1024 * 1024 + 1, 0x20); big.write("%PDF-1.4\n", 0, "latin1");
    await page.setInputFiles("#pub-pdf", { name: "큰.pdf", mimeType: "application/pdf", buffer: big });
    await page.waitForFunction(() => /20MB를 넘어요/.test(document.getElementById("pub-pdf-note").textContent));
    await page.click("#pub-submit");
    await page.waitForFunction(() => /20MB를 넘어요/.test(document.getElementById("pub-status").textContent));
    const n = await page.evaluate(() => ({ assets: window.__mockAssets.size, dialog: !!document.querySelector("dialog[open]"), research: Object.values(window.__mockDb.store).some((v) => v && v.title === "PDF 거절 테스트") }));
    assert(n.assets === 0 && !n.dialog && !n.research, JSON.stringify(n));
  });

  await test("publish: PDF 올리기 → reportAsset{id,filename,sizeBytes}만 저장 → 상세(pdf.js 막힘): '미리보기를 열 수 없어요' + PDF 저장 → 삭제하면 자산도 지움", async () => {
    await fillPublish(page, "PDF 보고서 연구");
    await page.check("#pub-report-kind-pdf");
    assert(await page.$eval("#pub-report", (el) => el.closest(".rn-field").hidden), "문서 선택이 보임");
    await page.setInputFiles("#pub-pdf", { name: "결과 보고서.pdf", mimeType: "application/pdf", buffer: PDF2 });
    await page.waitForFunction(() => /결과 보고서\.pdf/.test(document.getElementById("pub-pdf-note").textContent));
    // 확인 창에서 취소하면 아무것도 올리지 않는다
    await page.click("#pub-submit");
    await page.waitForSelector("dialog.rn-dialog[open]");
    await page.click("dialog.rn-dialog[open] .rn-btn:not(.rn-primary)");
    assert((await page.evaluate(() => window.__mockAssets.size)) === 0, "취소했는데 올림");
    await page.click("#pub-submit");
    await page.waitForSelector("dialog.rn-dialog[open]");
    await page.click("dialog.rn-dialog[open] .rn-primary");
    await page.waitForSelector("#research-pdf");
    const saved = await page.evaluate(() => {
      const [k, v] = Object.entries(window.__mockDb.store).find(([k, v]) => k.startsWith("research/") && v.title === "PDF 보고서 연구");
      return { id: k.split("/")[1], doc: v, assets: [...window.__mockAssets.keys()] };
    });
    const ra = saved.doc.reportAsset;
    assert(ra && JSON.stringify(Object.keys(ra).sort()) === '["filename","id","sizeBytes"]', "reportAsset 형식 " + JSON.stringify(ra));
    assert(ra.filename === "결과 보고서.pdf" && ra.sizeBytes === PDF2.length && saved.assets.includes(ra.id) && saved.doc.report === null, JSON.stringify(saved));
    assert(!JSON.stringify(saved.doc).includes("blob:") && !JSON.stringify(saved.doc).includes("/_blob/"), "URL을 저장함");
    // pdf.js를 불러오려 했고(막힘), 실패 경로가 깨끗하다
    await page.waitForSelector("#research-pdf-error");
    const v = await page.evaluate(() => ({ err: document.getElementById("research-pdf-error").textContent, canvases: document.querySelectorAll("#research-pdf canvas").length, more: document.getElementById("research-pdf-more").hidden, save: !!document.getElementById("research-pdf-save") }));
    assert(v.err === "미리보기를 열 수 없어요" && v.canvases === 0 && v.more && v.save, JSON.stringify(v));
    assert(page.__pdfjsRequests.some((u) => u.endsWith("/pdf.min.js")), "pdf.js를 요청하지 않음");
    assert((await page.textContent("#research-report")).includes("결과 보고서.pdf"), "파일 이름");
    const dlBefore = await page.evaluate(() => (window.__downloads || []).length);
    await page.click("#research-pdf-save");
    await page.waitForFunction((n) => (window.__downloads || []).length > n, dlBefore);
    const dl = await page.evaluate(async () => { const d = window.__downloads[window.__downloads.length - 1]; return { name: d.filename, head: d.data instanceof Blob ? await d.data.slice(0, 5).text() : String(d.data).slice(0, 5), size: d.data.size }; });
    assert(dl.name === "결과 보고서.pdf" && dl.head === "%PDF-" && dl.size === PDF2.length, "PDF 저장 " + JSON.stringify(dl));
    // 검색 카드에 '결과보고서 있음'
    const hit = await page.evaluate((id) => RN.search("PDF 보고서 연구").research.find((r) => r.id === id), saved.id);
    assert(hit && hit.hasReport, "hasReport " + JSON.stringify(hit));
    // 삭제: 사용자가 눌렀을 때 자산도 지운다
    await page.click("#research-delete");
    await page.waitForSelector("dialog.rn-dialog[open]");
    assert((await page.textContent("dialog.rn-dialog[open]")).includes("PDF도 함께"), "삭제 확인 문구");
    await page.click("dialog.rn-dialog[open] .rn-danger");
    await page.waitForFunction(([aid, rid]) => !window.__mockAssets.has(aid) && !(("research/" + rid) in window.__mockDb.store), [ra.id, saved.id]);
    const after = await page.evaluate(([aid, rid]) => ({ asset: window.__mockAssets.has(aid), doc: ("research/" + rid) in window.__mockDb.store }), [ra.id, saved.id]);
    assert(!after.asset && !after.doc, "삭제 후 " + JSON.stringify(after));
  });

  await test("research 상세: 작성자는 PDF로 바꿀 수 있다(문서 보고서 → reportAsset, report는 null)", async () => {
    await go(page, "research", { id: "t-rep" });
    await page.waitForSelector("#research-pdf-upload");
    assert((await page.textContent("#research-pdf-upload")) === "PDF 올리기");
    await page.setInputFiles("#research-pdf-file", { name: "새 보고서.pdf", mimeType: "application/pdf", buffer: PDF2 });
    await page.waitForSelector("dialog.rn-dialog[open]");
    await page.click("dialog.rn-dialog[open] .rn-primary");
    await page.waitForSelector("#research-pdf");
    const d = await page.evaluate(() => window.__mockDb.store["research/t-rep"]);
    assert(d.report === null && d.reportAsset && d.reportAsset.filename === "새 보고서.pdf", JSON.stringify(d).slice(0, 300));
    assert(!(await page.$("#research-report-paper")), "HTML 보고서가 남아 있음");
    // 다른 사용자에게는 올리기 버튼이 없다
    const p2 = await newPage("?user=u2");
    await p2.evaluate((doc) => window.__mockDb.seed({ "research/t-rep": doc }), d);
    await go(p2, "research", { id: "t-rep" });
    await p2.waitForSelector("#research-pdf");
    assert(!(await p2.$("#research-pdf-upload")), "남의 연구에 올리기 버튼");
    // 다른 사용자 화면에는 이 자산이 없으므로(메모리 mock) /_blob/ 주소가 404 → 미리보기 실패 경로
    await p2.waitForSelector("#research-pdf-error");
    await p2.close();
  });

  if (HAS_PDFJS) {
    await test("PDF 미리보기(pdf.js 가짜 워커): 첫 쪽만 그리고 '다음 쪽 더 보기'로 이어 그린다", async () => {
      const p = await newPage("", null, { pdfjs: true });
      const id = await p.evaluate(async (bytes) => {
        const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        const a = await RN.caps.assets.upload(blob, { type: "application/pdf" });
        await RN.caps.db.collection("research").doc("t-pdf").set({ title: "PDF 미리보기 연구", summary: "s", field: "물리", keywords: ["미리보기"], limitations: "", authorId: "u2", publishedAt: 1, report: null, reportAsset: { id: a.id, filename: "a.pdf", sizeBytes: a.sizeBytes } });
        return a.id;
      }, [...PDF2]);
      await go(p, "research", { id: "t-pdf" });
      await p.waitForSelector("#research-pdf canvas", { timeout: 15000 });
      const one = await p.evaluate(() => ({ n: document.querySelectorAll("#research-pdf canvas").length, more: document.getElementById("research-pdf-more").textContent, worker: typeof window.pdfjsWorker }));
      assert(one.n === 1 && one.more.includes("2/2") && one.worker === "object", JSON.stringify(one));
      await p.click("#research-pdf-more");
      await p.waitForFunction(() => document.querySelectorAll("#research-pdf canvas").length === 2);
      assert(await p.$eval("#research-pdf-more", (b) => b.hidden), "마지막 쪽인데 더 보기 버튼");
      assert(!(await p.$("#research-pdf-error")), "오류 표시 " + id);
      await p.close();
    });
  } else console.log("  --  pdf.js 렌더링 경로: node_modules/pdfjs-dist 없음 → 건너뜀(로드 실패 경로만 확인)");

  await test("assets가 없으면(?noassets=1) PDF 올리기를 숨기고 한 줄로 이유를 알린다", async () => {
    const p = await newPage("?noassets=1");
    await go(p, "publish", { projectId: "p1" });
    await p.waitForSelector("#publish-form");
    assert(!(await p.$("#pub-report-kind-pdf")) && !(await p.$("#pub-pdf")), "PDF 선택지가 보임");
    assert((await p.textContent("#pub-pdf-unavailable")).includes("PDF 올리기"), "이유 안내");
    await go(p, "research", { id: "t-rep" });
    await p.waitForSelector("#research-report");
    assert(!(await p.$("#research-pdf-upload")), "상세에 올리기 버튼");
    await p.close();
  });

  await test("projectSections: '연구 공개하기' 버튼과 키워드 추천", async () => {
    const r = await page.evaluate(() => {
      const sec = (RN.projectSections || []).find((s) => s.id === "research");
      if (!sec) return null;
      const box = document.createElement("div"); document.getElementById("rn-view").append(box);
      const off = sec.mount(box, { id: "p1", title: "x", keywords: ["음향 블랙홀"] });
      const out = { publish: !!box.querySelector("#project-publish"), card: !!box.querySelector('[data-research-id="seed-r01"]'), pain: !!box.querySelector('[data-pain-id="seed-p001"]') };
      if (typeof off === "function") off(); box.remove();
      return out;
    });
    assert(r && r.publish && r.card && r.pain, JSON.stringify(r));
  });

  await test("챗봇: search_site 도구 결과로 답하고 출처 링크로 이동, 대화 저장", async () => {
    await go(page, "home");
    await page.evaluate(() => {
      window.__calls = [];
      window.__mockSample = async (text, opts, input) => {
        window.__calls.push({ text, rules: input[0].content, hasTools: !!opts.tools });
        const tool = (opts.tools || []).find((t) => t.name === "search_site");
        if (!tool) return "도구 없음";
        const q = /양자/.test(text) ? "양자 컴퓨터" : "음향 블랙홀";
        const res = await tool.execute({ query: q }, { signal: new AbortController().signal });
        window.__lastTool = res;
        return res.result_count ? "이 사이트에 관련 연구가 있어요: " + res.results[0].title : "이 사이트에는 관련 연구가 아직 없어요.";
      };
    });
    const fab = await page.$eval("#chat-fab", (b) => ({ name: b.getAttribute("aria-label"), w: b.offsetWidth, h: b.offsetHeight, text: b.textContent.trim() }));
    assert(fab.name === "AI 도우미" && fab.w <= 56 && fab.w === fab.h && !fab.text, "작은 원형 아이콘 버튼 " + JSON.stringify(fab));
    await page.click("#chat-fab");
    assert(!(await page.isVisible("#chat-thread")) && !(await page.isVisible("#chat-usage")) && (await page.isVisible("#chat-menu-btn")), "부가 요소가 메뉴 밖에 보임");
    await page.fill("#chat-input", "음향 블랙홀 관련 연구 있어?");
    await page.click("#chat-send");
    await page.waitForSelector('#chat-float [data-cite="research:seed-r01"]');
    const call = await page.evaluate(() => window.__calls[0]);
    assert(call.hasTools && call.rules.includes("사이트에 없는 연구를 있다고 말하지 않는다"), "지시문/도구");
    // 0건이면 출처가 비어야 한다
    await page.fill("#chat-input", "양자 컴퓨터 연구 있어?");
    await page.click("#chat-send");
    await page.waitForFunction(() => document.querySelectorAll("#chat-float .chat-msg.assistant").length === 2 && !document.querySelector("#chat-float [aria-busy]"));
    const last = await page.evaluate(() => { const ms = document.querySelectorAll("#chat-float .chat-msg.assistant"); const m = ms[ms.length - 1]; return { cites: !!m.querySelector("[data-citations]"), text: m.textContent, tool: window.__lastTool }; });
    assert(!last.cites && last.tool.result_count === 0 && /없/.test(last.tool.instruction), "0건인데 출처 " + JSON.stringify(last));
    // 저장 (개인 영역 chats/items/{tid})
    const saved = await page.evaluate(() => Object.entries(window.__mockDb.store).filter(([k]) => /^data\/users\/u1\/chats\/items\/[^/]+$/.test(k)));
    assert(saved.length === 1 && saved[0][1].messages.length === 4 && saved[0][1].messages[1].citations.some((c) => c.id === "seed-r01"), "저장 " + JSON.stringify(saved).slice(0, 300));
    const usage = await page.evaluate(() => window.__mockDb.store["data/users/u1/aiUsage"]);
    assert(usage && usage.count >= 2, "사용량 " + JSON.stringify(usage));
    // 출처 클릭 → 연구 상세
    await page.click('#chat-float [data-cite="research:seed-r01"]');
    await page.waitForSelector("#research-summary");
    assert((await page.textContent("h1")).includes("음향 블랙홀"), "출처 이동");
  });

  await test("챗봇: 저장된 대화를 다시 열어 이어가기", async () => {
    const p2 = await page.context().newPage();
    await p2.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await p2.goto(BASE);
    await p2.waitForFunction(() => window.RN && RN.shared.loaded.research);
    await p2.click("#chat-fab");
    assert(!(await p2.isVisible("#chat-thread")), "이전 대화 고르기가 메뉴 밖에 보임");
    await p2.click("#chat-menu-btn");
    await p2.waitForFunction(() => document.querySelectorAll("#chat-thread option").length > 1);
    assert((await p2.textContent("#chat-usage")).includes("오늘"), "남은 횟수가 메뉴 안에 없음");
    const v = await p2.$eval("#chat-thread option:nth-child(2)", (o) => o.value);
    await p2.selectOption("#chat-thread", v);
    await p2.waitForFunction(() => document.querySelectorAll("#chat-float .chat-msg").length === 4);
    await p2.close();
  });

  await test("챗봇: 일일 한도를 넘으면 보내지 않는다", async () => {
    await page.evaluate(() => { RN.aiDailyLimit = 0; window.__calls = []; });
    await page.fill("#chat-input", "한 번 더");
    await page.click("#chat-send");
    await page.waitForSelector("#chat-float [role=alert]");
    assert((await page.textContent("#chat-float [role=alert]")).includes("모두 썼어요"));
    assert((await page.evaluate(() => window.__calls.length)) === 0, "한도 초과인데 호출함");
    await page.evaluate(() => { RN.aiDailyLimit = undefined; });
  });

  await test("에디터 패널 'AI 도우미': 선택 영역을 컨텍스트로, '삽입'을 눌러야만 반영(text·latex·format)", async () => {
    const r = await page.evaluate(async () => {
      const panel = (RN.editorPanels || []).find((p) => p.id === "chat");
      if (!panel) return { err: "패널 없음" };
      window.__ins = [];
      const prevEditor = RN.editor;
      RN.editor = {
        docId: "d1", projectId: "p1",
        getSelectionText: () => "실험 결과는 좋았다 그래서 좋았다.",
        getDocText: () => "서론 본문 결과 실험 결과는 좋았다 그래서 좋았다.",
        insertText: (t, o) => window.__ins.push(["text", t, o]),
        insertLatex: (l, o) => window.__ins.push(["latex", l, o]),
        applyFormat: (f) => window.__ins.push(["format", f]),
      };
      window.__mockSample = async (text, opts, input) => {
        window.__rules = input[0].content;
        const t = (n) => opts.tools.find((x) => x.name === n);
        await t("suggest_text").execute({ content: "실험 결과는 기대보다 좋았다.", mode: "replace_selection" }, {});
        await t("suggest_latex").execute({ latex: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}", display: "block" }, {});
        await t("suggest_format").execute({ rules: { body: { sizePt: 10, lineHeight: 160 } }, summary: "본문 10pt" }, {});
        return "세 가지를 제안했어요. 삽입을 눌러야 반영돼요.";
      };
      const box = document.createElement("div"); box.id = "test-panel"; document.getElementById("rn-view").append(box);
      panel.mount(box, RN.editor);
      document.getElementById("chat-input-ed").value = "이 문단 다듬어줘";
      document.getElementById("chat-send-ed").click();
      for (let i = 0; i < 50 && box.querySelectorAll("[data-suggestion]").length < 3; i++) await new Promise((r) => setTimeout(r, 50));
      const before = window.__ins.length;
      const btns = [...box.querySelectorAll("[data-suggestion]")];
      const math = !!box.querySelector(".chat-math math");
      btns.forEach((b) => b.click());
      await new Promise((r) => setTimeout(r, 50));
      const out = { before, after: window.__ins.slice(), n: btns.length, math, katex: typeof katex !== "undefined", sel: window.__rules.includes("<selection"), ctx: document.getElementById("chat-ctx-ed").textContent };
      box.remove(); RN.editor = prevEditor;
      return out;
    });
    assert(!r.err, r.err);
    assert(r.sel && r.ctx.includes("선택 영역"), "선택 영역 컨텍스트 " + r.ctx);
    assert(r.n === 3 && r.before === 0, "누르기 전 반영됨/카드 수 " + JSON.stringify(r));
    assert(r.after.length === 3 && r.after[0][0] === "text" && r.after[0][2].replaceSelection === true && r.after[1][0] === "latex" && r.after[2][1].body.sizePt === 10, JSON.stringify(r.after));
    if (r.katex) assert(r.math, "KaTeX MathML 미리보기 없음");
  });

  await test("챗봇: 도구를 못 쓰는 환경이면 미리 검색 결과만으로 답하고 출처도 그 결과에서", async () => {
    const p3 = await newPage();
    await p3.evaluate(() => {
      window.__mockSample = async (text, opts, input) => {
        if (opts.tools) throw { code: "tools_unavailable", message: "no tools" };
        window.__rules = input[0].content;
        return "있어요.\n```suggest-latex\nE = mc^2\n```";
      };
    });
    await p3.click("#chat-fab");
    await p3.fill("#chat-input", "음향 블랙홀에 대한 연구 있어?");
    await p3.click("#chat-send");
    await p3.waitForSelector('#chat-float [data-cite="research:seed-r01"]');
    const r = await p3.evaluate(() => ({ rules: window.__rules, sugg: document.querySelectorAll("#chat-float [data-suggestion=latex]").length, text: document.querySelector("#chat-float .chat-msg.assistant").textContent }));
    assert(r.rules.includes("<site_search>") && r.rules.includes("seed-r01"), "미리 검색 결과가 없음");
    assert(r.sugg === 1 && !r.text.includes("```"), "코드 블록 제안 " + JSON.stringify(r));
    await p3.evaluate(() => { window.__mockSample = async () => { throw { code: "not_granted", message: "x" }; }; });
    await p3.fill("#chat-input", "또 물어볼게");
    await p3.click("#chat-send");
    await p3.waitForFunction(() => document.querySelector("#chat-send").disabled && /쓸 수 없어요/.test(document.querySelector("#chat-float").textContent));
    await p3.close();
  });

  await test("sample이 없으면 'AI 기능을 쓸 수 없어요' 안내만", async () => {
    const p = await newPage("?nosample=1");
    await p.click("#chat-fab");
    assert((await p.textContent("#chat-float")).includes("AI 기능을 쓸 수 없어요"));
    assert(!(await p.$("#chat-input")), "입력창이 있음");
    await p.close();
  });

  await test("비로그인(?anon=1): 화면이 깨지지 않는다", async () => {
    const p = await newPage("?anon=1");
    for (const [n, params] of [["home"], ["explore", { q: "음향" }], ["research", { id: "seed-r01" }], ["publish", { projectId: "p1" }]]) {
      await go(p, n, params);
      const t = await p.textContent("main");
      assert(!t.includes("화면을 그리지 못했어요"), n + " 깨짐");
      assert(await p.$("main h1"), n + " h1 없음");
    }
    assert((await p.textContent("main")).includes("로그인"), "로그인 안내");
    await go(p, "explore", { q: "음향" });
    assert((await p.textContent("main")).includes("로그인"), "explore 로그인 안내");
    await p.click("#chat-fab");
    assert(await p.$("#chat-float:not([hidden])"), "챗봇 패널");
    await p.close();
  });

  await test("휴대폰 폭(400px)에서 가로 스크롤 없음", async () => {
    const p = await newPage("", { width: 400, height: 800 });
    for (const [n, params] of [["home"], ["explore", { q: "음향 블랙홀" }], ["research", { id: "t-rep" }]]) {
      await go(p, n, params);
      await p.waitForTimeout(100);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(over <= 0, n + " 가로 넘침 " + over);
    }
    await p.click("#chat-fab");
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(over <= 0, "챗봇 가로 넘침 " + over);
    await p.close();
  });

  await test("에디터 화면에서는 플로팅 버튼을 숨긴다", async () => {
    const hidden = await page.evaluate(() => { document.body.dataset.view = "editor"; const v = getComputedStyle(document.getElementById("chat-fab")).display; document.body.dataset.view = "home"; return v; });
    assert(hidden === "none", hidden);
  });

  await test("내 모듈에서 페이지 오류 없음", async () => { assert(errors.length === 0, errors.join("\n")); });

  await browser.close();
  server.kill();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log("실패: " + failures.join(", ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
