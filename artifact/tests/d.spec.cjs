// 데이터(mod-data.js) 테스트 — node tests/d.spec.cjs  (HWP 보기·가져오기는 tests/d-convert.spec.cjs)
// dev-server를 4104 포트로 띄우고 Playwright(chromium)로 확인한다. 외부 CDN(KaTeX, PapaParse)은 node_modules의 같은 파일로 돌려준다.
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");

const PORT = 4104;
const BASE = `http://localhost:${PORT}/dev.html`;
const ROOT = path.join(__dirname, "..");
const NM = path.join(ROOT, "..", "node_modules");
const FIX = path.join(ROOT, "..", "tests", "fixtures");

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push({ name, ok: false, e }); console.log(`  FAIL ${name}\n       ${(e && e.stack) || e}`); }
}
function startServer() {
  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, ["dev-server.mjs", String(PORT)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    srv.stdout.on("data", (d) => { if (String(d).includes("http://")) resolve(srv); });
    srv.stderr.on("data", (d) => process.stderr.write(d));
    srv.on("exit", (c) => reject(new Error("server exited " + c)));
    setTimeout(() => reject(new Error("server start timeout")), 10000);
  });
}

let browser;
const pageErrors = [];
async function newContext(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, ...opts });
  await ctx.route("https://cdnjs.cloudflare.com/**", (r) => {
    const u = r.request().url();
    const f = u.includes("papaparse") ? path.join(NM, "papaparse", "papaparse.min.js") : u.includes("katex") ? path.join(NM, "katex", "dist", "katex.min.js") : null;
    return f && fs.existsSync(f) ? r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(f) }) : r.abort();
  });
  await ctx.route("https://fonts.googleapis.com/**", (r) => r.abort());
  return ctx;
}
async function open(ctx, query = "", hash = "home") {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String((e && e.stack) || e)));
  await page.goto(`${BASE}${query ? "?" + query : ""}#${hash}`);
  await page.waitForFunction(() => window.RN && window.RN._data && window.RN.caps && document.querySelector("#rn-view h1, #rn-view .rn-notice"));
  await page.evaluate(() => RN.ready);
  return page;
}
const store = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__mockDb.store)));
const reset = (page) => page.evaluate(() => window.__mockDb.reset());
/** 프로젝트 홈이 없어도 섹션을 직접 붙인다 */
async function mountSection(page, id, project = { id: "p1", title: "진자 실험" }) {
  await page.evaluate(([sid, p]) => {
    document.querySelectorAll(".test-host").forEach((n) => n.remove());
    const host = document.createElement("div"); host.className = "test-host"; host.id = "host-" + sid;
    document.getElementById("rn-view").replaceChildren(host);
    const s = RN.projectSections.find((x) => x.id === sid);
    window.__off = s.mount(host, p);
  }, [id, project]);
}
/** 가짜 에디터를 끼우고 데이터 패널을 붙인다 */
async function mountPanel(page) {
  await page.evaluate(() => {
    window.__calls = [];
    const api = {
      docId: "d1", projectId: "p1",
      insertTable: (a) => window.__calls.push(["table", JSON.parse(JSON.stringify(a))]),
      insertFigure: (a) => window.__calls.push(["figure", JSON.parse(JSON.stringify(a))]),
      insertText() {}, insertLatex() {}, getSelectionText: () => "", getDocText: () => "", applyFormat() {},
    };
    RN.editor = api;
    const host = document.createElement("div"); host.id = "host-panel";
    document.getElementById("rn-view").replaceChildren(host);
    const p = RN.editorPanels.find((x) => x.id === "data");
    window.__offPanel = p.mount(host, api);
  });
}
const upload = (page, selector, file) => page.setInputFiles(selector, typeof file === "string" ? file : file);

(async () => {
  const srv = await startServer();
  browser = await chromium.launch();
  try {
    const ctx = await newContext();
    const page = await open(ctx);
    await reset(page);

    console.log("순수 함수");
    await test("회귀: 기울기 1.96, 절편 0.22, R² 0.998856", async () => {
      const r = await page.evaluate(() => RN._data.linearRegression([[1, 2.2], [2, 4.1], [3, 6.2], [4, 7.9], [5, 10.1]]));
      assert.ok(Math.abs(r.slope - 1.96) < 1e-9, r.slope);
      assert.ok(Math.abs(r.intercept - 0.22) < 1e-9, r.intercept);
      assert.equal(r.r2.toFixed(6), "0.998856");
      assert.equal(r.n, 5);
      assert.equal(await page.evaluate(() => RN._data.linearRegression([[1, 1], [1, 2]])), null);
    });
    await test("분위수·상자그림·히스토그램", async () => {
      const v = await page.evaluate(() => {
        const D = RN._data;
        return { q: D.quantile([1, 2, 3, 4], 0.25), med: D.quantile([1, 2, 3, 4, 5], 0.5), box: D.boxStats([1, 2, 3, 4, 5, 6, 7, 8, 100]), hist: D.histogram([1, 2, 2, 3, 3, 3, 4, 4, 5]), hist3: D.histogram([0, 10], 2), same: D.histogram([7, 7, 7]) };
      });
      assert.equal(v.q, 1.75); assert.equal(v.med, 3);
      assert.deepEqual([v.box.q1, v.box.median, v.box.q3, v.box.whiskerHigh, v.box.outliers], [3, 5, 7, 8, [100]]);
      assert.equal(v.hist.length, 5); // 1 + log2(9) → 5
      assert.equal(v.hist.reduce((a, b) => a + b.count, 0), 9);
      assert.deepEqual(v.hist3.map((b) => b.count), [1, 1]);
      assert.deepEqual(v.same, [{ start: 7, end: 7, count: 3 }]);
    });
    await test("숫자·단위·날짜 읽기, 열 타입 추론", async () => {
      const v = await page.evaluate(() => {
        const D = RN._data;
        return {
          a: D.parseNumber("1,234.5"), b: D.parseNumber("12.5 mm"), c: D.parseNumber("30%"), d: D.parseNumber("abc"),
          date: D.parseDate("2026-03-01"), kdate: D.parseDate("2026년 3월 1일"),
          col: D.inferColumn("진폭", ["12.5 mm", "10 mm", "NA", ""]),
          mixed: D.inferColumn("길이", ["12.5 cm", "130 mm"]),
        };
      });
      assert.deepEqual(v.a, { value: 1234.5, unit: null });
      assert.deepEqual(v.b, { value: 12.5, unit: "mm" });
      assert.deepEqual(v.c, { value: 30, unit: "%" });
      assert.equal(v.d, null);
      assert.equal(v.date, Date.UTC(2026, 2, 1)); assert.equal(v.kdate, v.date);
      assert.deepEqual(v.col, { name: "진폭", type: "number", unit: "mm", missing: 2 });
      assert.equal(v.mixed.type, "string");
    });
    await test("CSV fixture: CP949 · UTF-8 BOM · 결측 · 단위 섞임", async () => {
      const files = Object.fromEntries(["korean-cp949", "korean-utf8-bom", "missing", "mixed-units"].map((n) => [n, [...fs.readFileSync(path.join(FIX, "csv", n + ".csv"))]]));
      const r = await page.evaluate((f) => Object.fromEntries(Object.entries(f).map(([k, b]) => [k, RN._data.parseCsv(new Uint8Array(b))])), files);
      const cp = r["korean-cp949"];
      assert.equal(cp.encoding, "euc-kr");
      assert.deepEqual(cp.columns.map((c) => c.name), ["시간(s)", "진폭", "온도", "비고"]);
      assert.deepEqual(cp.columns.map((c) => c.type), ["number", "number", "number", "string"]);
      assert.equal(cp.columns[1].unit, "mm");
      assert.equal(cp.columns[2].missing, 1);
      assert.equal(cp.rows[2][3], "감쇠 구간");
      assert.equal(r["korean-utf8-bom"].encoding, "utf-8");
      assert.deepEqual(r["korean-utf8-bom"].columns, cp.columns);
      const ms = r.missing;
      assert.deepEqual(ms.columns.map((c) => [c.type, c.missing]), [["number", 1], ["number", 2], ["string", 1]]);
      const mu = r["mixed-units"];
      assert.deepEqual(mu.columns.map((c) => c.type), ["string", "string", "number", "date"]);
      assert.equal(mu.columns[2].unit, "g");
      assert.ok(mu.warnings.some((w) => w.includes("길이") && w.includes("단위")), mu.warnings.join("|"));
    });
    await test("표 칸: 단위 떼기, 소수 자릿수, 머리글 끄기", async () => {
      const v = await page.evaluate(() => {
        const D = RN._data;
        const p = D.parseCsvText("시간,진폭\n0,12.5 mm\n1,NA\n");
        const o = D.defaultTableOptions(p.columns);
        return { a: D.tableInsertArgs(p.columns, p.rows, o, "캡션"), b: D.tableInsertArgs(p.columns, p.rows, { ...o, decimals: 2, headerRow: false }, "") };
      });
      assert.deepEqual(v.a, { header: ["시간", "진폭 (mm)"], rows: [["0", "12.5"], ["1", ""]], caption: "캡션" });
      assert.deepEqual(v.b.header, []);
      assert.deepEqual(v.b.rows, [["시간", "진폭 (mm)"], ["0.00", "12.50"], ["1.00", ""]]);
    });
    await test("256KiB 한도: 앞에서부터 잘라 저장", async () => {
      const v = await page.evaluate(() => {
        const rows = Array.from({ length: 20000 }, (_, i) => [String(i), String(i * 1.2345), "긴 메모 문자열 " + i]);
        const doc = { projectId: "p", name: "big", columns: [], rows, rowCount: rows.length, createdAt: 1 };
        const f = RN._data.fitDataset(doc);
        return { truncated: f.truncated, kept: f.doc.rows.length, size: RN._data.byteSize(f.doc), rowCount: f.doc.rowCount };
      });
      assert.ok(v.truncated); assert.ok(v.size <= 256 * 1024, v.size); assert.ok(v.size > 240 * 1024, v.size);
      assert.equal(v.kept, v.rowCount);
    });

    console.log("그래프 SVG");
    await test("유형마다 SVG를 만들고 fill·viewBox 규칙을 지킨다", async () => {
      const out = await page.evaluate(() => {
        const D = RN._data;
        const p = D.parseCsvText("x,y,err,group,date\n1,2.2,0.2,A,2026-03-01\n2,4.1,0.3,A,2026-03-02\n3,6.2,0.2,B,2026-03-04\n4,7.9,0.4,B,2026-03-08\n5,10.1,0.3,B,2026-03-09\n");
        const cfgs = {
          line: { type: "line", x: "x", y: "y", error: "err", trendline: true, xTitle: "시간", xUnit: "s", yTitle: "거리", yUnit: "m" },
          scatter: { type: "scatter", x: "x", y: "y", trendline: true },
          bar: { type: "bar", x: "group", y: "y", error: "err" },
          histogram: { type: "histogram", x: "y" },
          box: { type: "box", x: "group", y: "y" },
          logScatter: { type: "scatter", x: "x", y: "y", logX: true, logY: true },
          dateLine: { type: "line", x: "date", y: "y" },
        };
        const res = {};
        for (const [k, c] of Object.entries(cfgs)) {
          const r = D.renderChartSvg(c, p.columns, p.rows);
          const doc = new DOMParser().parseFromString(r.svg, "image/svg+xml");
          const shapes = [...doc.querySelectorAll("rect,circle,line,polyline,path,polygon,text")];
          const host = document.createElement("div"); host.style.width = "640px"; host.innerHTML = r.svg; document.body.append(host);
          const svg = host.querySelector("svg"), vb = svg.viewBox.baseVal;
          // 글자가 viewBox 밖으로 나가지 않는지
          const out = [...svg.querySelectorAll("text")].filter((t) => { const b = t.getBBox(); const m = t.getCTM(); const pts = [[b.x, b.y], [b.x + b.width, b.y + b.height]].map(([x, y]) => { const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; return pt.matrixTransform(m); }); return pts.some((q) => q.x < -1 || q.y < -1 || q.x > vb.width + 1 || q.y > vb.height + 1); }).map((t) => t.textContent);
          host.remove();
          res[k] = { ok: r.ok, n: r.n, noFill: shapes.filter((s) => !s.getAttribute("fill")).length, currentColor: r.svg.includes("currentColor"), texts: shapes.filter((s) => s.tagName === "text").map((t) => t.textContent), out, reg: r.regression, bins: r.bins && r.bins.length, groups: r.groups && r.groups.map((g) => g.label), parseErr: !!doc.querySelector("parsererror") };
        }
        return res;
      });
      for (const [k, r] of Object.entries(out)) {
        assert.ok(r.ok, k); assert.equal(r.noFill, 0, k + " fill"); assert.equal(r.currentColor, false, k); assert.equal(r.parseErr, false, k);
        assert.deepEqual(r.out, [], k + " 라벨이 viewBox 밖: " + r.out.join(","));
      }
      assert.ok(out.line.texts.some((t) => t.includes("y = 1.96x + 0.22") && t.includes("R² = 0.9989")), out.line.texts.join("|"));
      assert.ok(out.line.texts.includes("시간 (s)") && out.line.texts.includes("거리 (m)"));
      assert.equal(out.histogram.bins, 4); // 1 + log2(5) → 4
      assert.deepEqual(out.box.groups, ["A", "B"]);
      assert.ok(out.dateLine.texts.some((t) => /^2026-03-\d\d$/.test(t)), out.dateLine.texts.join("|"));
      assert.ok(out.logScatter.texts.includes("10"));
    });
    await test("열 이름 이스케이프, 잘못된 열·문자 Y 오류", async () => {
      const v = await page.evaluate(() => {
        const D = RN._data;
        const p = D.parseCsvText('"<b>x</b>",y,메모\n1,2,a\n2,3,b\n');
        return { a: D.renderChartSvg({ type: "scatter", x: "<b>x</b>", y: "y" }, p.columns, p.rows).svg, b: D.renderChartSvg({ type: "scatter", x: "없음", y: "y" }, p.columns, p.rows), c: D.renderChartSvg({ type: "scatter", x: "y", y: "메모" }, p.columns, p.rows) };
      });
      assert.ok(!v.a.includes("<b>") && v.a.includes("&lt;b&gt;"));
      assert.equal(v.b.ok, false); assert.match(v.b.error, /없어요/);
      assert.equal(v.c.ok, false); assert.match(v.c.error, /숫자 열이 아니에요/);
    });
    await test("AI 추천 → 설정: 없는 열은 버린다", async () => {
      const v = await page.evaluate(() => {
        const D = RN._data;
        const cols = D.parseCsvText("시간,진폭\n0,12.5 mm\n1,10 mm\n").columns;
        const base = D.defaultChartConfig(cols);
        return {
          ok: D.configFromSuggestion(base, { chartType: "line", x: "시간", y: ["진폭"], errorBar: null, logX: false, logY: false, trendline: true, xTitle: "시간", yTitle: "진폭 (mm)" }, cols),
          bad: D.configFromSuggestion(base, { chartType: "line", x: "온도", y: ["진폭"] }, cols),
          badType: D.configFromSuggestion(base, { chartType: "pie", x: "시간", y: ["진폭"] }, cols),
          hist: D.configFromSuggestion(base, { chartType: "histogram", x: null, y: ["진폭"] }, cols),
          prompt: D.suggestPrompt(cols),
        };
      });
      assert.equal(v.ok.type, "line"); assert.equal(v.ok.yTitle, "진폭"); assert.equal(v.ok.yUnit, "mm"); assert.equal(v.ok.trendline, true);
      assert.equal(v.bad, null); assert.equal(v.badType, null);
      assert.equal(v.hist.x, "진폭");
      assert.ok(!v.prompt.includes("12.5"), "값은 보내지 않는다");
    });

    console.log("프로젝트 섹션 \"데이터\"");
    await test("CP949 CSV 올리기 → 저장·미리보기", async () => {
      await mountSection(page, "data");
      await page.waitForSelector("#host-data .rn-notice");
      await upload(page, "#data-csv-file", path.join(FIX, "csv", "korean-cp949.csv"));
      await page.waitForFunction(() => document.querySelector("#host-data")?.innerText.includes("저장했어요"));
      const text = await page.locator("#host-data").innerText();
      assert.ok(text.includes("CP949"), text);
      assert.ok(text.includes("진폭 숫자(mm)"), text);
      assert.ok(text.includes("감쇠 구간"), "방금 올린 데이터는 미리보기가 펼쳐져 있다");
      // 올리기 버튼 하나(주 버튼), 배지 묶음 없음
      assert.equal(await page.locator("#host-data .rn-primary").count(), 1);
      assert.equal(await page.locator("#host-data .rn-badge").count(), 0);
      const s = await store(page);
      const keys = Object.keys(s).filter((k) => k.startsWith("data/users/u1/datasets/items/"));
      assert.equal(keys.length, 1);
      const ds = s[keys[0]];
      assert.equal(ds.projectId, "p1"); assert.equal(ds.name, "korean-cp949"); assert.equal(ds.rowCount, 5); assert.equal(ds.encoding, "euc-kr");
      assert.equal(ds.columns[0].name, "시간(s)");
      await page.waitForSelector("#host-data li[data-id]");
      const li = page.locator("#host-data li[data-id]");
      assert.match(await li.innerText(), /5행 · 4열/);
      assert.ok((await li.innerText()).includes("21.8"));
      await li.locator("button", { hasText: "접기" }).click();
      assert.ok(!(await li.innerText()).includes("21.8"));
      await li.locator("button", { hasText: "미리보기" }).click();
      assert.ok((await li.innerText()).includes("21.8"));
    });
    await test("큰 CSV는 잘라 저장하고 알린다", async () => {
      const big = "a,b,c\n" + Array.from({ length: 30000 }, (_, i) => `${i},${i * 0.5},메모${i}`).join("\n");
      await upload(page, "#data-csv-file", { name: "big.csv", mimeType: "text/csv", buffer: Buffer.from(big) });
      await page.waitForFunction(() => document.querySelector("#host-data")?.innerText.includes("앞 ") && document.querySelector("#host-data").innerText.includes("행만 저장"));
      const s = await store(page);
      const big1 = Object.entries(s).find(([k, v]) => k.includes("/datasets/items/") && v.name === "big")[1];
      assert.ok(big1.rows.length < 30000 && big1.rows.length > 1000); assert.equal(big1.originalRowCount, 30000);
      assert.ok(Buffer.byteLength(JSON.stringify(big1)) <= 256 * 1024);
    });
    await test("빈 파일 오류, 삭제", async () => {
      await upload(page, "#data-csv-file", { name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from("\n\n") });
      await page.waitForFunction(() => document.querySelector("#host-data")?.innerText.includes("빈 CSV"));
      // 삭제는 ⋯ 메뉴 안: 키보드로 열고(↓) Esc로 닫으면 버튼으로 돌아온다
      const more = page.locator("#host-data li[data-id]", { hasText: "big" }).locator("button[aria-haspopup=menu]");
      assert.equal(await page.locator("#host-data li[data-id] button", { hasText: "삭제" }).first().isVisible(), false);
      await more.focus();
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("role") + ":" + document.activeElement.textContent), "menuitem:삭제");
      await page.keyboard.press("Escape");
      assert.equal(await more.getAttribute("aria-expanded"), "false");
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-haspopup")), "menu");
      await more.click();
      await page.locator("#host-data [role=menuitem]:visible", { hasText: "삭제" }).click();
      await page.locator("dialog button", { hasText: "지우기" }).click();
      await page.waitForFunction(() => document.querySelectorAll("#host-data li[data-id]").length === 1);
    });

    console.log("에디터 패널 \"데이터\" (가짜 RN.editor)");
    await test("표 만들기 → insertTable 인자", async () => {
      await mountPanel(page);
      await page.waitForFunction(() => document.querySelector("#data-ds-select option")?.value);
      // 단계형: ① 데이터 ② 표/그래프 ③ 설정, 주 버튼은 "문서에 넣기" 하나
      assert.equal(await page.locator("#host-panel .rn-primary").count(), 1);
      assert.equal(await page.locator("#data-insert").innerText(), "문서에 넣기");
      await page.click("#data-tab-table");
      assert.equal(await page.getAttribute("#data-tab-table", "aria-pressed"), "true");
      await page.waitForSelector("#data-tbl-preview");
      assert.equal(await page.locator("#data-tbl-dec").isVisible(), false, "소수 자릿수는 자세히 안에");
      await page.uncheck("#data-tbl-c-3");
      await page.click("#data-tbl-more > summary");
      await page.selectOption("#data-tbl-dec", "1");
      await page.fill("#data-tbl-h-0", "시간");
      await page.fill("#data-tbl-u-0", "s");
      await page.fill("#data-tbl-caption", "진폭 측정");
      await page.click("#data-insert");
      const calls = await page.evaluate(() => window.__calls);
      assert.equal(calls.length, 1); assert.equal(calls[0][0], "table");
      const a = calls[0][1];
      assert.deepEqual(a.header, ["시간 (s)", "진폭 (mm)", "온도"]);
      assert.deepEqual(a.rows[0], ["0.0", "12.5", "21.3"]);
      assert.deepEqual(a.rows[2], ["2.0", "8.3", ""]);
      assert.equal(a.caption, "진폭 측정");
    });
    await test("그래프 만들기 → 미리보기·insertFigure(svg, caption, meta)", async () => {
      await page.click("#data-tab-chart");
      await page.waitForSelector("#data-ch-preview svg");
      // 유형·X·Y만 먼저 보이고 나머지는 "자세히" 안
      for (const id of ["#data-ch-type", "#data-ch-x", "#data-ch-y"]) assert.equal(await page.locator(id).isVisible(), true, id);
      for (const id of ["#data-ch-err", "#data-ch-xtitle", "#data-ch-logx", "#data-ch-trend", "#data-ch-caption"]) assert.equal(await page.locator(id).isVisible(), false, id);
      await page.selectOption("#data-ch-type", "scatter");
      await page.selectOption("#data-ch-x", "시간(s)");
      await page.selectOption("#data-ch-y", "진폭");
      await page.click("#data-ch-more > summary");
      await page.check("#data-ch-trend");
      await page.waitForSelector("#data-ch-preview svg");
      assert.match(await page.locator("#data-ch-reg").innerText(), /R² = 0\.9\d+/);
      await page.click("#data-insert");
      const calls = await page.evaluate(() => window.__calls);
      const f = calls[1];
      assert.equal(f[0], "figure");
      assert.ok(f[1].svg.startsWith("<svg") && f[1].svg.includes("viewBox"));
      assert.equal(f[1].caption, "시간(s)에 따른 진폭");
      assert.equal(f[1].meta.kind, "chart"); assert.ok(f[1].meta.datasetId);
      assert.deepEqual([f[1].meta.chart.type, f[1].meta.chart.x, f[1].meta.chart.y, f[1].meta.chart.trendline, f[1].meta.chart.yUnit], ["scatter", "시간(s)", "진폭", true, "mm"]);
    });
    await test("유형 바꾸기(히스토그램·상자그림·막대·꺾은선) 미리보기", async () => {
      for (const t of ["histogram", "box", "bar", "line"]) {
        await page.selectOption("#data-ch-type", t);
        await page.waitForSelector("#data-ch-preview svg");
        assert.equal(await page.locator("#data-ch-type").isVisible(), true);
      }
      // 히스토그램 구간 수도 "자세히" 안
      await page.selectOption("#data-ch-type", "histogram");
      assert.equal(await page.locator("#data-ch-bins").count(), 1);
      await page.selectOption("#data-ch-type", "line");
    });
    await test("설정 다시 편집(최근 넣은 그래프, RN.data.editFigure)", async () => {
      assert.equal(await page.locator("#data-recent").getAttribute("open"), null, "최근 넣은 그래프는 접혀 있다");
      await page.click("#data-recent > summary");
      await page.locator("#data-recent button", { hasText: "다시 편집" }).first().click();
      assert.equal(await page.inputValue("#data-ch-type"), "scatter");
      assert.equal(await page.isChecked("#data-ch-trend"), true);
      await page.selectOption("#data-ch-type", "bar");
      const ok = await page.evaluate(() => { const m = window.__calls[1][1].meta; return RN.data.editFigure(m); });
      assert.equal(ok, true);
      assert.equal(await page.inputValue("#data-ch-type"), "scatter");
    });
    await test("그래프 추천: 열 이름·타입만 보내고 있는 열만 적용", async () => {
      await page.evaluate(() => {
        window.__prompts = [];
        window.__mockSample = async (text) => { window.__prompts.push(text); return JSON.stringify({ suggestions: [
          { chartType: "line", x: "없는열", y: ["진폭"], errorBar: null, logX: false, logY: false, trendline: false, xTitle: "", yTitle: "", reason: "가짜" },
          { chartType: "line", x: "시간(s)", y: ["온도"], errorBar: null, logX: false, logY: false, trendline: true, xTitle: "시간", yTitle: "온도", reason: "시간에 따른 변화" }] }); };
      });
      await page.click("#data-ch-suggest");
      await page.waitForSelector("#data-ch-reason");
      assert.equal(await page.inputValue("#data-ch-type"), "line");
      assert.equal(await page.inputValue("#data-ch-y"), "온도");
      assert.match(await page.locator("#data-ch-reason").innerText(), /시간에 따른 변화/);
      const prompts = await page.evaluate(() => window.__prompts);
      assert.ok(prompts[0].includes("진폭") && !prompts[0].includes("12.5") && !prompts[0].includes("감쇠"));
    });
    await test("AI 없음(?nosample=1)이면 추천 버튼을 숨긴다", async () => {
      const p2 = await open(ctx, "nosample=1");
      await mountPanel(p2);
      await p2.waitForSelector("#data-ch-preview svg");
      assert.equal(await p2.locator("#data-ch-suggest").count(), 0);
      await p2.close();
    });
    await test("섹션 등록: label 데이터", async () => {
      assert.equal(await page.evaluate(() => RN.projectSections.find((x) => x.id === "data").label), "데이터");
      assert.equal(await page.evaluate(() => RN.editorPanels.find((x) => x.id === "data").label), "데이터");
    });
    await test("비로그인이면 안내만 보이고 오류 없음", async () => {
      const p3 = await open(ctx, "anon=1");
      await mountSection(p3, "data");
      assert.match(await p3.locator("#host-data").innerText(), /로그인/);
      await mountPanel(p3);
      assert.match(await p3.locator("#host-panel").innerText(), /로그인/);
      await p3.close();
    });

    console.log("휴대폰 폭");
    await test("400px에서 가로 스크롤 없음(패널·섹션)", async () => {
      const pctx = await newContext({ viewport: { width: 400, height: 800 } });
      const p = await open(pctx);
      await p.evaluate(() => {
        const r = RN._data.parseCsvText("x,y\n1,2\n2,4\n3,5\n");
        window.__mockDb.seed({ "data/users/u1/datasets/items/m1": { projectId: "p1", name: "모바일", columns: r.columns, rows: r.rows, rowCount: 3, createdAt: 1 } });
      });
      await mountPanel(p);
      await p.waitForSelector("#data-ch-preview svg");
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 400), "panel " + (await p.evaluate(() => document.documentElement.scrollWidth)));
      await p.click("#data-ch-more > summary");
      await p.click("#data-tab-table");
      await p.click("#data-tbl-more > summary");
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 400), "panel table " + (await p.evaluate(() => document.documentElement.scrollWidth)));
      await mountSection(p, "data");
      await p.waitForSelector("#host-data li[data-id]");
      await p.locator("#host-data li[data-id] button", { hasText: "미리보기" }).first().click();
      await p.locator("#host-data button[aria-haspopup=menu]").first().click();
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 400), "section " + (await p.evaluate(() => document.documentElement.scrollWidth)));
      await pctx.close();
    });

    await test("페이지 오류 없음", async () => {
      const mine = pageErrors.filter((e) => /mod-data/.test(e));
      assert.deepEqual(mine, []);
      if (pageErrors.length) console.log("       (다른 모듈 오류 " + pageErrors.length + "개 무시)");
    });
    await ctx.close();
  } finally {
    await browser.close();
    srv.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exit(failed ? 1 : 0);
})();
