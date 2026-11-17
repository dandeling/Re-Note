// 고충 게시판(mod-pains.js) 테스트 — node tests/b.spec.cjs
// dev-server를 4102 포트로 띄우고 Playwright(chromium)로 확인한다.
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");

const PORT = 4102;
const BASE = `http://localhost:${PORT}/dev.html`;
const ROOT = path.join(__dirname, "..");

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
async function newContext() {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  return ctx;
}
async function open(ctx, query = "", hash = "pains", page) {
  page = page || (await ctx.newPage());
  if (!page.__hooked) {
    page.__hooked = true;
    page.on("pageerror", (e) => pageErrors.push(String((e && e.stack) || e)));
  }
  await page.goto(`${BASE}${query ? "?" + query : ""}#${hash}`);
  await page.waitForFunction(() => window.RN && document.querySelector("#rn-view h1"));
  return page;
}
const go = (page, name, params) => page.evaluate(([n, p]) => RN.go(n, p), [name, params || {}]);
const store = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__mockDb.store)));
const reset = (page) => page.evaluate(() => window.__mockDb.reset());
const seed = (page, rows) => page.evaluate((r) => window.__mockDb.seed(r), rows);
const h1 = (page) => page.locator("#rn-view h1").first().innerText();
const painIds = (s) => Object.keys(s).filter((k) => /^pains\/[^/]+$/.test(k)).map((k) => k.split("/")[1]);

/** "추가 설정"(details)을 연다 */
async function openMore(page) {
  await page.waitForSelector("#pain-more-settings", { state: "attached" });
  if (!(await page.evaluate(() => document.querySelector("#pain-more-settings").open))) await page.click("#pain-more-settings > summary");
}
/** ⋯ 메뉴를 열고 항목을 누른다 */
async function menu(page, itemId) {
  await page.waitForSelector("#pain-more");
  if ((await page.getAttribute("#pain-more", "aria-expanded")) !== "true") await page.click("#pain-more");
  await page.click(itemId);
}
async function writePain(page, { title, body, stage = "ANALYSIS", field = "물리", tags = "통계, 설문", anon = false }) {
  await go(page, "pain-edit", {});
  await page.fill("#pain-title", title);
  await page.fill("#pain-body", body);
  await page.selectOption("#pain-stage", stage);
  await openMore(page);
  await page.fill("#pain-field", field);
  await page.fill("#pain-tags", tags);
  if (anon) await page.check("#pain-anon");
  await page.click("#pain-save");
  await page.waitForFunction((t) => document.querySelector("#rn-view h1").textContent === t, title);
}
/** 상세 화면에 댓글 구역이 없다(입력창·버튼·목록·"댓글" 글자 모두) */
async function assertNoComments(page) {
  await page.waitForSelector("#pain-body");
  for (const sel of ["#pain-comment", "#pain-comment-send", "#pain-comments"]) assert.equal(await page.locator(sel).count(), 0, sel + " 가 없어야 한다");
  assert.ok(!(await page.locator("#rn-view").innerText()).includes("댓글"), "화면에 '댓글' 글자가 없다");
}
async function confirmDialog(page, label) {
  await page.locator("dialog[open]").getByRole("button", { name: label, exact: true }).click();
}

function mkPain(i, over = {}) {
  return {
    title: `고충 ${String(i).padStart(2, "0")}`, body: `본문 ${i}`, stage: i % 2 ? "EXPERIMENT" : "DESIGN", field: i % 3 ? "물리" : "화학",
    tags: i % 5 === 0 ? ["오차"] : ["측정"], isAnonymous: false, authorId: "u3", researchId: null, resolved: false, resolution: null,
    createdAt: 1700000000000 + i * 1000, updatedAt: 1700000000000 + i * 1000, meTooCount: (i * 7) % 11, commentCount: 2 /* 예전 필드: 무시돼야 한다 */, ...over,
  };
}

(async () => {
  const srv = await startServer();
  browser = await chromium.launch();
  try {
    await test("작성·수정·삭제 (u1)", async () => {
      const ctx = await newContext();
      const page = await open(ctx);
      await reset(page);
      await page.click("#pains-new");
      await page.waitForSelector("#pain-title");
      // 빈 제목은 막힌다
      await page.click("#pain-save");
      assert.match(await page.locator("#pain-form-error").innerText(), /제목/);
      await writePain(page, { title: "적분 구간이 헷갈려요", body: "**굵게** 본문" });
      let s = await store(page);
      const [id] = painIds(s);
      const doc = s["pains/" + id];
      assert.equal(doc.authorId, "u1");
      assert.deepEqual(doc.tags, ["통계", "설문"]);
      assert.equal(doc.stage, "ANALYSIS");
      assert.equal(doc.meTooCount, 0);
      assert.ok(!("commentCount" in doc), "새 글에 commentCount를 쓰지 않는다");
      await assertNoComments(page);
      assert.ok(s[`data/users/u1/myPains/items/${id}`], "개인 영역에 내 글 표시");
      assert.equal(await page.locator("#pain-body strong").innerText(), "굵게");
      // 처음 보이는 동작은 한 줄: 수정·삭제·해결됨은 ⋯ 메뉴 안에 숨어 있다
      assert.equal(await page.locator("#pain-edit").isVisible(), false);
      // 수정
      await menu(page, "#pain-edit");
      await page.waitForSelector("#pain-title");
      assert.equal(await page.inputValue("#pain-title"), "적분 구간이 헷갈려요");
      await page.fill("#pain-title", "적분 구간이 헷갈려요 (수정)");
      await page.click("#pain-save");
      await page.waitForFunction(() => document.querySelector("#rn-view h1").textContent.includes("(수정)"));
      s = await store(page);
      assert.equal(s["pains/" + id].title, "적분 구간이 헷갈려요 (수정)");
      assert.match(await page.locator("#rn-view").innerText(), /수정됨/);
      // 삭제
      await menu(page, "#pain-delete");
      const dlgText = await page.locator("dialog[open]").innerText();
      assert.match(dlgText, /공감 기록도 함께 지워져요/);
      assert.ok(!dlgText.includes("댓글"));
      await confirmDialog(page, "삭제");
      await page.waitForFunction(() => document.body.dataset.view === "pains");
      s = await store(page);
      assert.equal(painIds(s).length, 0);
      assert.ok(!s[`data/users/u1/myPains/items/${id}`]);
      await ctx.close();
    });

    await test("정렬·필터·검색·쪽 나누기", async () => {
      const ctx = await newContext();
      const page = await open(ctx);
      await reset(page);
      const rows = {};
      for (let i = 1; i <= 25; i++) rows[`pains/p${i}`] = mkPain(i);
      rows["pains/p7"].body = "열전도율 측정에서 **편차**가 큽니다";
      await seed(page, rows);
      await go(page, "pains");
      await page.waitForSelector("#pains-list");
      const items = () => page.locator("#pains-list > li h2").allInnerTexts();
      let t = await items();
      assert.equal(t.length, 20);
      assert.equal(t[0], "고충 25"); // 최신순
      assert.match(await page.locator("#rn-view [role=status]").first().innerText(), /25건/);
      await page.click("#pains-next");
      t = await items();
      assert.equal(t.length, 5);
      assert.equal(t[4], "고충 01");
      // 처음 보이는 것: 검색·정렬·필터 버튼. 단계·분야·태그는 "필터"를 눌러야 보인다
      assert.equal(await page.locator("#pains-stage").isVisible(), false);
      assert.equal(await page.getAttribute("#pains-filter-toggle", "aria-expanded"), "false");
      // 공감순: meTooCount = i*7 % 11 → 최대 10 (i=3,14,25 → 25가 최신)
      await page.click("#pains-sort-popular");
      assert.equal(await page.getAttribute("#pains-sort-popular", "aria-pressed"), "true");
      t = await items();
      assert.equal(t[0], "고충 25");
      assert.equal(t[1], "고충 14");
      assert.equal(t[2], "고충 03");
      // 단계 필터
      await page.click("#pains-sort-latest");
      await page.click("#pains-filter-toggle");
      assert.equal(await page.getAttribute("#pains-filter-toggle", "aria-expanded"), "true");
      assert.equal(await page.locator("#pains-filter-clear").isVisible(), false);
      await page.selectOption("#pains-stage", "DESIGN");
      t = await items();
      assert.equal(t.length, 12);
      assert.ok(t.every((x) => Number(x.slice(3)) % 2 === 0));
      assert.equal(await page.locator("#pains-filter-toggle").innerText(), "필터 1");
      // 분야 + 태그
      await page.selectOption("#pains-stage", "");
      await page.selectOption("#pains-field", "화학");
      t = await items();
      assert.deepEqual(t, ["고충 24", "고충 21", "고충 18", "고충 15", "고충 12", "고충 09", "고충 06", "고충 03"]);
      await page.selectOption("#pains-tag", "오차");
      t = await items();
      assert.deepEqual(t, ["고충 15"]);
      assert.equal(await page.locator("#pains-filter-toggle").innerText(), "필터 2");
      // 필터 지우기
      await page.click("#pains-filter-clear");
      t = await items();
      assert.equal(t.length, 20);
      assert.equal(await page.locator("#pains-filter-toggle").innerText(), "필터");
      // 목록 항목: 구분선 + 제목·본문 한 줄·메타 한 줄(배지 묶음 없음)
      const row = page.locator("#pains-list > li").first();
      assert.equal(await row.locator(".rn-badge").count(), 0);
      const metaText = await row.locator(".rn-pain-meta").innerText();
      assert.match(metaText, /^(실험|설계) · (물리|화학) · 공감 \d+$/);
      assert.ok(!(await page.locator("#pains-list").innerText()).includes("댓글"), "목록 메타에 댓글 수가 없다");
      // 검색(본문)
      await page.fill("#pains-q", "열전도율 편차");
      t = await items();
      assert.deepEqual(t, ["고충 07"]);
      await page.fill("#pains-q", "고충 25");
      t = await items();
      assert.deepEqual(t, ["고충 25"]); // 제목
      await page.fill("#pains-q", "없는검색어");
      assert.match(await page.locator("#rn-view").innerText(), /조건에 맞는 고충이 없어요/);
      // 휴대폰 폭에서 가로 스크롤 없음
      await page.fill("#pains-q", "");
      await page.click("#pains-filter-toggle"); // 필터를 펼친 상태로
      await page.setViewportSize({ width: 400, height: 800 });
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= 400, "scrollWidth " + sw);
      await ctx.close();
    });

    await test("시나리오 4: 다른 계정의 나도 겪었어요 → 원 작성자가 해결됨 처리", async () => {
      const ctx = await newContext();
      const p1 = await open(ctx);
      await reset(p1);
      await writePain(p1, { title: "설문 응답률이 낮아요", body: "응답률이 10%예요" });
      const [id] = painIds(await store(p1));
      // 작성자는 자기 글에 "나도 겪었어요"를 누를 수 없다
      assert.equal(await p1.locator("#pain-metoo").count(), 0);
      await p1.close();

      const p2 = await open(ctx, "user=u2");
      await go(p2, "pain", { id });
      await p2.waitForSelector("#pain-metoo");
      assert.equal(await p2.locator("#pain-edit").count(), 0, "다른 사람에게 수정 버튼이 없다");
      assert.equal(await p2.locator("#pain-delete").count(), 0);
      await assertNoComments(p2); // 다른 사람도 댓글을 달 수 없다
      await p2.click("#pain-metoo");
      await p2.waitForFunction(() => document.querySelector("#pain-metoo[aria-pressed=true] #pain-metoo-count")?.textContent === "1");
      await p2.waitForFunction((pid) => window.__mockDb.store["pains/" + pid].meTooCount === 1, id);
      let s = await store(p2);
      assert.ok(s[`pains/${id}/reactions/u2`]);
      assert.ok(!Object.keys(s).some((k) => k.startsWith(`pains/${id}/comments/`)), "댓글 문서가 생기지 않는다");
      // 토글: 한 번 더 누르면 취소, 다시 누르면 1
      await p2.click("#pain-metoo");
      await p2.waitForFunction((pid) => window.__mockDb.store["pains/" + pid].meTooCount === 0, id);
      await p2.click("#pain-metoo");
      await p2.waitForFunction((pid) => window.__mockDb.store["pains/" + pid].meTooCount === 1, id);
      // 신고(⋯ 메뉴 안) — 키보드로 열고 닫기
      await p2.focus("#pain-more");
      assert.equal(await p2.getAttribute("#pain-more", "aria-haspopup"), "menu");
      await p2.keyboard.press("ArrowDown");
      assert.equal(await p2.getAttribute("#pain-more", "aria-expanded"), "true");
      assert.equal(await p2.evaluate(() => document.activeElement.id), "pain-report");
      await p2.keyboard.press("Escape");
      assert.equal(await p2.getAttribute("#pain-more", "aria-expanded"), "false");
      assert.equal(await p2.evaluate(() => document.activeElement.id), "pain-more");
      await p2.keyboard.press("Enter");
      assert.equal(await p2.evaluate(() => document.activeElement.id), "pain-report");
      await p2.keyboard.press("Enter");
      await p2.fill("#pain-report-reason", "광고 같아요");
      await p2.click("#pain-report-reason-ok");
      await p2.waitForFunction(() => Object.keys(window.__mockDb.store).some((k) => k.startsWith("reports/")));
      s = await store(p2);
      const rep = Object.entries(s).find(([k]) => k.startsWith("reports/"))[1];
      assert.equal(rep.painId, id);
      assert.ok(!JSON.stringify(rep).includes("u2"), "신고에 신고자 id 없음");
      await p2.close();

      const p3 = await open(ctx);
      await go(p3, "pain", { id });
      await p3.waitForSelector("#pain-resolve", { state: "attached" });
      await p3.waitForFunction(() => document.querySelector("#pain-metoo-count-ro")?.textContent.includes("1"));
      // 작성자 메뉴: 화살표로 이동(수정 → 해결됨 → 삭제 → 처음으로)
      await p3.focus("#pain-more");
      await p3.keyboard.press("Enter");
      const order = [];
      for (let i = 0; i < 4; i++) { order.push(await p3.evaluate(() => document.activeElement.id)); await p3.keyboard.press("ArrowDown"); }
      assert.deepEqual(order, ["pain-edit", "pain-resolve", "pain-delete", "pain-edit"]);
      await p3.keyboard.press("End");
      assert.equal(await p3.evaluate(() => document.activeElement.id), "pain-delete");
      await p3.keyboard.press("Escape");
      assert.equal(await p3.locator("#pain-more-menu").isVisible(), false);
      await assertNoComments(p3);
      await menu(p3, "#pain-resolve");
      await p3.click("#pain-resolution-ok"); // 빈 해결 방법은 막힌다
      assert.match(await p3.locator("dialog[open] [role=alert]").innerText(), /해결 방법/);
      await p3.fill("#pain-resolution", "리마인더 문자를 **두 번** 보냈더니 40%가 됐어요");
      await p3.click("#pain-resolution-ok");
      await p3.waitForSelector("#pain-resolution-box");
      s = await store(p3);
      assert.equal(s["pains/" + id].resolved, true);
      assert.match(s["pains/" + id].resolution, /리마인더/);
      // 해결 방법이 본문보다 위에 강조된다
      const before = await p3.evaluate(() => !!(document.querySelector("#pain-resolution-box").compareDocumentPosition(document.querySelector("#pain-body")) & Node.DOCUMENT_POSITION_FOLLOWING));
      assert.ok(before);
      assert.equal(await p3.locator("#pain-resolution-box strong").last().innerText(), "두 번");
      assert.match(await p3.locator("#rn-view").innerText(), /해결됨/);
      await p3.setViewportSize({ width: 400, height: 800 });
      assert.ok((await p3.evaluate(() => document.documentElement.scrollWidth)) <= 400);
      await p3.click("#pain-more"); // 메뉴를 펼쳐도 가로 스크롤 없음
      assert.ok(await p3.locator("#pain-unresolve").isVisible());
      assert.ok((await p3.evaluate(() => document.documentElement.scrollWidth)) <= 400);
      // 바깥을 누르면 닫힌다
      await p3.click("#pain-body");
      assert.equal(await p3.getAttribute("#pain-more", "aria-expanded"), "false");
      await ctx.close();
    });

    await test("익명 글: 공유 문서 어디에도 작성자 id가 없다", async () => {
      const ctx = await newContext();
      const page = await open(ctx);
      await reset(page);
      await seed(page, { "research/r1": { title: "내 공개 연구", summary: "", field: "물리", keywords: [], limitations: "", authorId: "u1", publishedAt: 1, report: null } });
      await go(page, "pain-edit", { researchId: "r1" });
      await page.waitForSelector("#pain-research");
      assert.equal(await page.inputValue("#pain-research"), "r1", "연구 미리 선택");
      assert.equal(await page.evaluate(() => document.querySelector("#pain-more-settings").open), true, "연구가 미리 골라져 있으면 추가 설정이 열려 있다");
      await page.check("#pain-anon");
      assert.equal(await page.locator("#pain-research").isDisabled(), true, "익명이면 연구 연결 불가");
      await page.fill("#pain-title", "지도교수님과 의견이 달라요");
      await page.fill("#pain-body", "익명으로 쓰는 고민");
      await page.fill("#pain-field", "사회");
      await page.click("#pain-save");
      await page.waitForFunction(() => document.querySelector("#rn-view h1").textContent === "지도교수님과 의견이 달라요");
      assert.ok(await page.locator("#pain-edit").count(), "내 익명 글은 수정 버튼이 보인다");
      await assertNoComments(page);
      const [id] = painIds(await store(page));
      // 실명 글 → 익명으로 바꿀 때: 예전에 달린 댓글 문서(화면엔 안 보임)의 내 id도 지워지는지
      await writePain(page, { title: "처음엔 실명", body: "본문" });
      const named = painIds(await store(page)).find((x) => x !== id);
      await seed(page, {
        [`pains/${named}/comments/old-mine`]: { body: "실명일 때 단 댓글", authorId: "u1", isPostAuthor: true, createdAt: 1 },
        [`pains/${named}/comments/old-other`]: { body: "다른 사람 댓글", authorId: "u2", isPostAuthor: false, createdAt: 2 },
      });
      await assertNoComments(page); // db에 댓글 문서가 있어도 화면엔 안 보인다
      await menu(page, "#pain-edit");
      await openMore(page);
      await page.check("#pain-anon");
      await page.click("#pain-save");
      await page.waitForFunction(() => document.querySelector("#rn-view h1").textContent === "처음엔 실명");
      const scrubbed = await store(page);
      assert.equal(scrubbed[`pains/${named}/comments/old-mine`].authorId, null, "예전 내 댓글의 작성자 id가 지워진다");
      assert.equal(scrubbed[`pains/${named}/comments/old-mine`].isPostAuthor, true);
      assert.equal(scrubbed[`pains/${named}/comments/old-other`].authorId, "u2", "다른 사람 댓글은 그대로");
      await page.close();

      const p2 = await open(ctx, "user=u2");
      await go(p2, "pain", { id });
      await p2.waitForSelector("#pain-metoo");
      assert.equal(await p2.locator("#pain-edit").count(), 0);
      const text = await p2.locator("#rn-view").innerText();
      assert.match(text, /익명/);
      assert.ok(!text.includes("김연구"), "u1 이름이 보이지 않는다");
      await assertNoComments(p2);
      // 연구 연결 목록에서 익명 글 제외
      assert.equal(await p2.evaluate(() => RN.pains.listFor({ researchId: "r1" }).length), 0);

      const s = await store(p2);
      const leaks = [];
      for (const [k, v] of Object.entries(s)) {
        if (!k.startsWith("pains/") && !k.startsWith("reports/")) continue; // 공개 연구(research)는 원래 실명
        if (k.split("/").includes("u1")) leaks.push(k);
        if (JSON.stringify(v).includes('"u1"')) leaks.push(k + " " + JSON.stringify(v));
      }
      assert.deepEqual(leaks, [], "공유 문서에 u1이 남음");
      const anonDocs = Object.entries(s).filter(([k, v]) => /^pains\/[^/]+$/.test(k) && v.isAnonymous);
      assert.equal(anonDocs.length, 2);
      for (const [, v] of anonDocs) { assert.equal(v.authorId, null); assert.equal(v.researchId, null); }
      const authorComments = Object.entries(s).filter(([k, v]) => k.includes("/comments/") && v.isPostAuthor);
      assert.equal(authorComments.length, 1);
      authorComments.forEach(([, v]) => assert.equal(v.authorId, null));
      await ctx.close();
    });

    await test("마크다운: 서식과 XSS 차단", async () => {
      const ctx = await newContext();
      const page = await open(ctx);
      const r = await page.evaluate(() => {
        window.__xss = 0;
        const src = [
          "# 제목", "**굵게** *기울임* ~~취소~~ `코드<b>`", "", "- 하나", "- 둘", "  - 안쪽", "", "1. 첫째", "2. 둘째", "", "> 인용 **강조**", "",
          "```", "<script>window.__xss=1</script>", "```", "",
          "<script>window.__xss=1</script>", "<img src=x onerror=\"window.__xss=1\">", "<iframe src=javascript:window.__xss=1></iframe>",
          "[나쁜](javascript:window.__xss=1) [나쁜2](JaVaScRiPt:alert(1)) [나쁜3]( \tjavascript:alert(1)) [데이터](data:text/html,<script>alert(1)</script>)",
          "[vb](vbscript:msgbox(1)) [엔티티](&#106;avascript:alert(1)) <javascript:alert(1)>",
          "[좋은](https://example.com/a?b=1&c=2) <https://example.org> https://bare.example.com/x. [메일](mailto:a@b.c)",
          "![이미지](https://evil.example/track.png) [](\"onmouseover=alert(1))",
          "<a href=\"javascript:alert(1)\">a</a> <svg onload=alert(1)>",
          "snake_case_word 와 a*b",
        ].join("\n");
        const node = RN.markdown(src);
        document.querySelector("#rn-view").append(node);
        const all = [...node.querySelectorAll("*")];
        return {
          tags: [...new Set(all.map((e) => e.tagName.toLowerCase()))].sort(),
          attrs: [...new Set(all.flatMap((e) => [...e.attributes].map((a) => a.name)))].sort(),
          hrefs: [...node.querySelectorAll("a")].map((a) => a.getAttribute("href")),
          text: node.textContent,
          h: node.querySelector("h3")?.textContent,
          strong: [...node.querySelectorAll("strong")].map((e) => e.textContent),
          em: [...node.querySelectorAll("em")].map((e) => e.textContent),
          code: [...node.querySelectorAll("code")].map((e) => e.textContent),
          nested: node.querySelectorAll("ul ul li").length,
          ol: node.querySelectorAll("ol > li").length,
          quoteStrong: node.querySelector("blockquote strong")?.textContent,
          rel: node.querySelector("a")?.getAttribute("rel"),
        };
      });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__xss), 0);
      const bad = ["script", "img", "iframe", "svg", "object", "embed", "style"];
      assert.deepEqual(r.tags.filter((t) => bad.includes(t)), []);
      assert.ok(r.attrs.every((a) => ["href", "rel", "target", "class", "start"].includes(a)), "attrs: " + r.attrs);
      assert.deepEqual(r.hrefs, ["https://example.com/a?b=1&c=2", "https://example.org/", "https://bare.example.com/x", "mailto:a@b.c"]);
      assert.ok(r.text.includes("<script>window.__xss=1</script>"), "원시 HTML은 글자로 보인다");
      assert.ok(r.text.includes("(이미지: 이미지)"));
      assert.equal(r.h, "제목");
      assert.deepEqual(r.strong, ["굵게", "강조"]);
      assert.deepEqual(r.em, ["기울임"]);
      assert.ok(r.code.includes("코드<b>"));
      assert.equal(r.nested, 1);
      assert.equal(r.ol, 2);
      assert.equal(r.quoteStrong, "강조");
      assert.match(r.rel, /noopener/);
      assert.ok(r.text.includes("snake_case_word"));
      // 저장된 글 본문으로도 확인 (공유 데이터 경로)
      await reset(page);
      await seed(page, { "pains/x1": mkPain(1, { title: "XSS", body: "<img src=x onerror=window.__xss=2> [x](javascript:window.__xss=2)" }) });
      await go(page, "pain", { id: "x1" });
      await page.waitForSelector("#pain-body");
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__xss), 0);
      assert.equal(await page.locator("#pain-body img, #pain-body a").count(), 0);
      await ctx.close();
    });

    await test("예시 데이터·연구 연결 목록·프로젝트 섹션", async () => {
      const ctx = await newContext();
      const page = await open(ctx);
      await reset(page);
      const seedRows = await page.evaluate(() => fetch("dev-seed.json").then((r) => r.json()));
      await seed(page, seedRows);
      await go(page, "pains");
      await page.waitForSelector("#pains-list");
      const txt = await page.locator("#pains-list").innerText();
      assert.match(txt, /예시/);
      assert.match(txt, /해결됨/);
      assert.equal(await page.locator("#pains-next").count(), 1, "60건이면 쪽이 나뉜다");
      const r = await page.evaluate(() => {
        const list = RN.pains.listFor({ researchId: "seed-r01" });
        const node = RN.pains.renderList(list);
        return { n: list.length, anon: list.filter((p) => p.isAnonymous).length, items: node.querySelectorAll("li").length };
      });
      assert.ok(r.n > 0);
      assert.equal(r.anon, 0);
      assert.equal(r.items, r.n);
      // 예시 글에는 수정 버튼이 없다
      const anyId = Object.keys(seedRows).find((k) => k.startsWith("pains/")).split("/")[1];
      await go(page, "pain", { id: anyId });
      await page.waitForSelector("#pain-body");
      assert.equal(await page.locator("#pain-edit").count(), 0);
      // 프로젝트에서 쓴 고충 → 개인 영역에 projectId, 공유 문서엔 없음
      await go(page, "pain-edit", { projectId: "proj1" });
      // 필수 항목만 먼저 보인다
      assert.equal(await page.locator("#pain-field").isVisible(), false);
      assert.equal(await page.locator("#pain-stage").isVisible(), true);
      assert.equal(await page.locator("#rn-view .rn-primary").count(), 1, "주 버튼 하나");
      await page.fill("#pain-title", "프로젝트 고충");
      await page.fill("#pain-body", "본문");
      await page.click("#pain-save");
      await page.waitForFunction(() => document.querySelector("#rn-view h1").textContent === "프로젝트 고충");
      const s = await store(page);
      const id = painIds(s).find((k) => s["pains/" + k].title === "프로젝트 고충");
      assert.equal(s[`data/users/u1/myPains/items/${id}`].projectId, "proj1");
      assert.ok(!JSON.stringify(s["pains/" + id]).includes("proj1"));
      const sec = await page.evaluate(async () => {
        const def = RN.projectSections.find((x) => x.id === "pains");
        const box = document.createElement("div");
        document.querySelector("#rn-view").append(box);
        const cleanup = def.mount(box, { id: "proj1", title: "P" });
        await new Promise((r) => setTimeout(r, 50));
        const out = { text: box.innerText, n: RN.pains.listFor({ projectId: "proj1" }).length, hasNew: !!box.querySelector("#project-pain-new"), label: def.label, buttons: box.querySelectorAll("button").length };
        if (typeof cleanup === "function") cleanup();
        return out;
      });
      assert.equal(sec.n, 1);
      assert.match(sec.text, /프로젝트 고충/);
      assert.ok(sec.hasNew);
      assert.equal(sec.label, "고충");
      assert.equal(sec.buttons, 1, "글쓰기 버튼 하나");
      await ctx.close();
    });

    await test("비로그인(?anon=1)은 읽기 전용 안내", async () => {
      const ctx = await newContext();
      const page = await open(ctx, "anon=1");
      await page.waitForSelector("#rn-view .rn-notice");
      assert.equal(await page.locator("#pains-new").count(), 0);
      assert.match(await page.locator("#rn-view").innerText(), /로그인/);
      await go(page, "pain-edit", {});
      assert.equal(await page.locator("#pain-title").count(), 0);
      assert.match(await page.locator("#rn-view").innerText(), /로그인/);
      await go(page, "pain", { id: "nope" });
      assert.equal(await page.locator("#pain-comment").count(), 0);
      assert.equal(await page.locator("#pain-comments").count(), 0);
      await ctx.close();
    });

    await test("mod-pains.js에서 난 스크립트 오류 없음", async () => {
      const mine = pageErrors.filter((e) => e.includes("mod-pains"));
      assert.deepEqual(mine, []);
      if (pageErrors.length) console.log("       (다른 모듈 오류 " + pageErrors.length + "건 — 무시)");
    });
  } finally {
    await browser.close();
    srv.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
