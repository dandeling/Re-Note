import { expect, test, type Page } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";

async function writePain(page: Page, fields: { title: string; body: string; tags?: string; anonymous?: boolean; stage?: string }) {
  await page.goto("/pains/new");
  await page.getByLabel("제목").fill(fields.title);
  await page.getByLabel("본문").fill(fields.body);
  if (fields.stage) await page.getByLabel("연구 단계").selectOption({ label: fields.stage });
  if (fields.tags) await page.getByLabel("태그").fill(fields.tags);
  if (fields.anonymous) await page.getByLabel("익명으로 올리기").check();
  await page.getByRole("button", { name: "올리기" }).click();
  await expect(page).toHaveURL(/\/pains\/(?!new$)[a-z0-9]+$/);
  return new URL(page.url()).pathname;
}

test("비로그인은 목록·상세를 읽을 수 있고, 작성 화면은 로그인으로 보낸다", async ({ browser, page }) => {
  const title = `읽기 전용 확인 ${Date.now()}`;
  const authorCtx = await browser.newContext();
  const author = await authorCtx.newPage();
  await login(author, uniqueEmail("reader-author"));
  const path = await writePain(author, { title, body: "본문입니다", tags: "읽기" });
  await authorCtx.close();

  await page.goto(`/pains?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await page.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(path);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("link", { name: "로그인하고 공감하기" })).toBeVisible();
  // 고충은 한 번에 쓰는 글이다: 댓글 목록·작성 폼이 없다(로그인 여부와 무관).
  await expect(page.getByLabel("댓글 쓰기")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^댓글/ })).toHaveCount(0);

  await page.goto("/pains/new");
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  expect((await page.request.post("/api/pains", { data: { title: "x", body: "y" } })).status()).toBe(401);
});

test("익명 글: 서버가 내려준 HTML·API 어디에도 작성자 정보가 없다", async ({ browser }) => {
  const email = uniqueEmail("anon-secret-writer");
  const secretName = email.split("@")[0]; // 테스트 로그인은 이메일 앞부분을 이름으로 쓴다.
  const title = `익명 고충 ${Date.now()}`;

  const authorCtx = await browser.newContext();
  const author = await authorCtx.newPage();
  await login(author, email);
  const session = await (await author.request.get("/api/auth/session")).json();
  const authorId = session.user.id as string;
  expect(authorId).toBeTruthy();
  const path = await writePain(author, { title, body: "이름을 밝히기 어려운 이야기", anonymous: true });
  // 작성자 본인 화면: "익명"으로 보이고, 접힌 "내 글 관리"를 펼치면 작성자 도구가 있다.
  await expect(author.getByTestId("pain-author")).toHaveText("익명");
  await author.getByText("내 글 관리").click();
  await expect(author.getByRole("button", { name: "해결됨으로 표시" })).toBeVisible();
  // 댓글 UI는 작성자에게도 없다.
  await expect(author.getByLabel("댓글 쓰기")).toHaveCount(0);

  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await login(other, uniqueEmail("anon-reader"));
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();

  for (const viewer of [other, guest]) {
    for (const url of [path, `/pains?q=${encodeURIComponent(title)}`, `/api${path}`, `/api/pains?q=${encodeURIComponent(title)}`]) {
      const res = await viewer.request.get(url);
      expect(res.status()).toBe(200);
      const text = await res.text();
      expect(text).toContain(title);
      for (const secret of [secretName, email, authorId]) expect(text, `${url} 에 ${secret}`).not.toContain(secret);
    }
    await viewer.goto(path);
    await expect(viewer.getByTestId("pain-author")).toHaveText("익명");
    await expect(viewer.getByText("내 글 관리")).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: "해결됨으로 표시" })).toHaveCount(0);
    // 렌더링이 끝난 DOM(스트리밍된 RSC 데이터 포함)에도 없다.
    const dom = await viewer.content();
    for (const secret of [secretName, email, authorId]) expect(dom).not.toContain(secret);
  }

  await authorCtx.close();
  await otherCtx.close();
  await guestCtx.close();
});

test("마크다운 본문의 스크립트는 실행되지 않는다", async ({ page }) => {
  await login(page, uniqueEmail("xss"));
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const payload = [
    "정상 **문장**",
    "<script>window.__xss = 1</script>",
    '<img src=x onerror="window.__xss = 2">',
    "[눌러보세요](javascript:window.__xss=3)",
    '<a href="javascript:alert(4)" onclick="alert(5)">클릭</a>',
  ].join("\n\n");
  await writePain(page, { title: `XSS 확인 ${Date.now()}`, body: payload });
  await page.reload();

  await expect(page.locator("article strong", { hasText: "문장" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  const main = page.locator("main");
  await expect(main.locator("script, img, iframe, [onclick], [onerror]")).toHaveCount(0);
  for (const href of await main.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
    expect(href).not.toMatch(/^\s*javascript:/i);
  }
  expect(dialogs).toEqual([]);
});

test("작성자는 수정·삭제할 수 있고, 목록에서 필터·정렬이 동작한다", async ({ page }) => {
  await login(page, uniqueEmail("pain-crud"));
  const stamp = Date.now();
  const tag = `태그${stamp}`;
  const path = await writePain(page, { title: `수정 전 ${stamp}`, body: "본문", tags: tag, stage: "실험" });
  await writePain(page, { title: `다른 글 ${stamp}`, body: "본문", tags: tag, stage: "분석" });

  // 수정
  await page.goto(path);
  await page.getByText("내 글 관리").click();
  await page.getByRole("link", { name: "수정" }).click();
  await expect(page).toHaveURL(`${path}/edit`);
  await expect(page.getByLabel("제목")).toHaveValue(`수정 전 ${stamp}`);
  await page.getByLabel("제목").fill(`수정 후 ${stamp}`);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(path);
  await expect(page.getByRole("heading", { level: 1, name: `수정 후 ${stamp}` })).toBeVisible();

  // 태그 필터 + 단계 필터 (필터는 접혀 있다. 키보드로 폼 제출)
  await page.goto("/pains");
  await expect(page.getByRole("textbox", { name: "태그" })).toBeHidden();
  await page.getByText("필터", { exact: true }).click();
  await page.getByRole("textbox", { name: "태그" }).fill(tag);
  await page.getByRole("textbox", { name: "태그" }).press("Enter");
  await expect(page).toHaveURL(/tag=/);
  await expect(page.getByText("2건")).toBeVisible();
  // 필터가 적용 중이면 펼친 채로 보이고, 개수가 표시된다.
  await expect(page.getByText("필터 1", { exact: true })).toBeVisible();
  await page.getByRole("search").getByLabel("연구 단계").selectOption({ label: "실험" });
  await page.getByRole("button", { name: "검색" }).click();
  await expect(page.getByText("1건")).toBeVisible();
  await expect(page.getByRole("link", { name: `수정 후 ${stamp}` })).toBeVisible();
  await expect(page.getByRole("link", { name: `다른 글 ${stamp}` })).toHaveCount(0);

  // 공감순 정렬
  await page.getByRole("link", { name: "필터 지우기" }).click();
  await expect(page).toHaveURL(/\/pains$/);
  await page.getByLabel("정렬").selectOption({ label: "공감순" });
  await page.getByRole("button", { name: "검색" }).click();
  await expect(page).toHaveURL(/sort=popular/);

  // 삭제
  await page.goto(path);
  await page.getByText("내 글 관리").click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "삭제" }).click();
  await expect(page).toHaveURL(/\/pains$/);
  expect((await page.goto(path))?.status()).toBe(404);
});

test("프로젝트 홈의 '내 고충'에서 프로젝트에 연결한 고충을 쓴다", async ({ page }) => {
  await login(page, uniqueEmail("pain-project"));
  await page.goto("/projects");
  await page.getByLabel("제목").fill("고충 연결 프로젝트");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);
  const projectPath = new URL(page.url()).pathname;
  await expect(page.getByText("이 프로젝트에 연결한 고충이 아직 없어요.")).toBeVisible();

  await page.getByRole("link", { name: "이 프로젝트의 고충 쓰기" }).click();
  await expect(page).toHaveURL(/\/pains\/new\?projectId=/);
  await expect(page.getByLabel("연결할 프로젝트 (선택)")).toHaveValue(projectPath.split("/").pop()!);
  await page.getByLabel("제목").fill("프로젝트에서 쓴 고충");
  await page.getByLabel("본문").fill("본문");
  await page.getByRole("button", { name: "올리기" }).click();
  await expect(page).toHaveURL(/\/pains\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByRole("link", { name: "연결된 내 프로젝트 보기" })).toBeVisible();

  await page.goto(projectPath);
  const section = page.getByRole("region", { name: "내 고충" });
  await expect(section.getByRole("link", { name: "프로젝트에서 쓴 고충" })).toBeVisible();
});
