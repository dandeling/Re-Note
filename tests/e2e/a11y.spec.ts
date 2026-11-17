import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";

/** WCAG 2.0/2.1 A·AA 규칙만 검사한다 (SPEC P8-2). */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
  expect(summary, `${label}: 접근성 위반`).toEqual([]);
}

/**
 * 검사할 페이지 목록. 다른 브랜치에서 구현 중인 페이지도 경로만 두면 병합 후 그대로 검사된다.
 * `path`가 함수면 로그인 후 만든 프로젝트·문서 경로를 받는다.
 */
type Ctx = { projectPath: string; docPath: string };
const PUBLIC_PAGES: { name: string; path: string }[] = [
  { name: "홈(비로그인)", path: "/" },
  { name: "로그인", path: "/login" },
  { name: "고충 게시판(비로그인)", path: "/pains" },
  { name: "탐색(비로그인)", path: "/explore" },
  { name: "변환 도구(비로그인)", path: "/tools/convert" },
];
const SIGNED_IN_PAGES: { name: string; path: string | ((c: Ctx) => string) }[] = [
  { name: "홈", path: "/" },
  { name: "프로젝트 목록", path: "/projects" },
  { name: "프로젝트 홈", path: (c) => c.projectPath },
  { name: "에디터", path: (c) => c.docPath },
  { name: "고충 게시판", path: "/pains" },
  { name: "탐색", path: "/explore" },
  { name: "변환 도구", path: "/tools/convert" },
  { name: "설정", path: "/settings" },
];

/** 프로젝트·문서는 API로 만든다(dev 서버의 첫 컴파일이 UI 쪽 기본 대기 시간 5초를 넘기지 않게). */
async function createDocViaApi(page: Page) {
  const projectRes = await page.request.post("/api/projects", { data: { title: "접근성 검사 프로젝트" } });
  expect(projectRes.status()).toBe(201);
  const { project } = await projectRes.json();
  const docRes = await page.request.post(`/api/projects/${project.id}/docs`, { data: { title: "접근성 검사 문서" } });
  expect(docRes.status()).toBe(201);
  const { document } = await docRes.json();
  const projectPath = `/projects/${project.id}`;
  return { projectPath, docPath: `${projectPath}/docs/${document.id}`, docId: document.id as string };
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.describe("자동 접근성 검사 (axe, WCAG 2 A/AA)", () => {
  for (const p of PUBLIC_PAGES) {
    test(`${p.name}: ${p.path}`, async ({ page }) => {
      await page.goto(p.path);
      await settle(page);
      await expectNoViolations(page, p.name);
    });
  }

  test("로그인한 사용자의 주요 페이지", async ({ page }) => {
    test.slow();
    await login(page, uniqueEmail("a11y"));
    const { projectPath, docPath, docId } = await createDocViaApi(page);
    const ctx: Ctx = { docPath, projectPath };

    for (const p of SIGNED_IN_PAGES) {
      const path = typeof p.path === "function" ? p.path(ctx) : p.path;
      await test.step(`${p.name}: ${path}`, async () => {
        await page.goto(path);
        await settle(page);
        await expectNoViolations(page, p.name);
      });
    }

    // 에디터의 버전 기록 패널이 열린 상태도 검사한다.
    expect((await page.request.post(`/api/docs/${docId}/snapshots`)).status()).toBe(201);
    await page.goto(docPath);
    await page.getByRole("button", { name: "버전 기록" }).click();
    await expect(page.getByTestId("snapshot-list")).toBeVisible();
    await expectNoViolations(page, "에디터(버전 기록 열림)");
  });
});

/** 지금 포커스된 요소를 설명하는 문자열 (접근 가능한 이름 위주) */
function focusedLabel(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "";
    return el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName;
  });
}

/** Tab(또는 Shift+Tab)만 눌러 원하는 이름의 요소에 도달한다. 도달하지 못하면 실패. */
async function tabTo(page: Page, label: string, { back = false, max = 80 } = {}) {
  for (let i = 0; i < max; i += 1) {
    if ((await focusedLabel(page)) === label) return;
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
  }
  throw new Error(`키보드로 "${label}"에 도달하지 못했습니다 (마지막 포커스: ${await focusedLabel(page)})`);
}

/** 포커스된 요소에 눈에 보이는 포커스 표시(outline 또는 box-shadow 링)가 있는지 */
function hasFocusIndicator(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    return outline || (style.boxShadow !== "none" && style.boxShadow !== "");
  });
}

test("키보드만으로 에디터의 서식·저장·버전 기록·복원을 쓸 수 있다", async ({ page }) => {
  test.slow();
  await login(page, uniqueEmail("kbd"));
  const { docPath } = await createDocViaApi(page);
  await page.goto(docPath);
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await expect(body).toBeVisible();

  // 페이지 처음부터 Tab으로 본문까지 간다 (건너뛰기 링크 → 헤더 → 도구 모음 → 본문)
  await page.locator("body").focus();
  await tabTo(page, "본문으로 건너뛰기");
  expect(await hasFocusIndicator(page)).toBe(true);
  await tabTo(page, "문서 본문");
  await expect(body).toBeFocused();
  expect(await hasFocusIndicator(page)).toBe(true);
  await page.keyboard.type("보존할 내용");
  await expect(body).toHaveText("보존할 내용");

  // 서식: 글자를 모두 선택하고 Shift+Tab으로 도구 모음의 "굵게"로 가서 Enter
  await page.keyboard.press("ControlOrMeta+a");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("보존할 내용");
  await tabTo(page, "굵게", { back: true });
  expect(await hasFocusIndicator(page)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(body.locator("strong")).toHaveText("보존할 내용");
  await expect(page.getByRole("button", { name: "굵게" })).toHaveAttribute("aria-pressed", "true");

  // 저장: Ctrl/Cmd+S
  await body.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("save-status")).toContainText("저장됨");

  // 버전 저장 버튼 (Shift+Tab으로 거슬러 올라가 Enter)
  await tabTo(page, "버전 저장", { back: true });
  expect(await hasFocusIndicator(page)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("editor-notice")).toHaveText("버전을 저장했어요.");

  // 내용을 바꾸고 저장
  await tabTo(page, "문서 본문");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("덮어쓴 내용");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("save-status")).toContainText("저장됨");

  // 버전 기록 열기 → Esc로 닫기 → 포커스가 버튼으로 돌아온다
  const historyButton = page.getByRole("button", { name: "버전 기록" });
  await tabTo(page, "버전 기록", { back: true });
  await page.keyboard.press("Enter");
  await expect(historyButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("snapshot-list")).toBeVisible();
  await tabTo(page, "닫기");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("snapshot-list")).toBeHidden();
  await expect(historyButton).toBeFocused();

  // 다시 열고 닫기 버튼으로 닫아도 포커스가 버튼으로 돌아온다
  await page.keyboard.press("Enter");
  await tabTo(page, "닫기");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("snapshot-list")).toBeHidden();
  await expect(historyButton).toBeFocused();

  // 열어서 "수동" 버전의 복원 버튼까지 Tab으로 가서 Enter (확인 창은 키보드로 수락)
  await page.keyboard.press("Enter");
  const manual = page.getByTestId("snapshot-list").getByRole("listitem").filter({ hasText: "수동" });
  await expect(manual).toHaveCount(1);
  const restore = manual.getByRole("button", { name: "복원" });
  for (let i = 0; i < 20 && !(await restore.evaluate((el) => el === document.activeElement)); i += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(restore).toBeFocused();
  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Enter");
  await expect(body).toHaveText("보존할 내용");
  await expect(page.getByTestId("editor-notice")).toHaveText("선택한 버전으로 복원했어요.");
});

test("표 안에서도 Esc로 에디터를 빠져나와 키보드로 다음 요소로 갈 수 있다 (키보드 트랩 없음)", async ({ page }) => {
  await login(page, uniqueEmail("trap"));
  const { docPath } = await createDocViaApi(page);
  await page.goto(docPath);
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await body.click();
  await tabTo(page, "표 삽입", { back: true });
  await page.keyboard.press("Enter");
  await expect(body.locator("table")).toBeVisible();
  // 표 안에서 Tab은 셀 이동에 쓰여 포커스가 본문에 머문다.
  await page.keyboard.press("Tab");
  await expect(body).toBeFocused();
  // Esc로 본문에서 나오면 Shift+Tab이 도구 모음으로 간다.
  await page.keyboard.press("Escape");
  await expect(body).not.toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("toolbar", { name: "서식 도구" }).locator(":focus")).toHaveCount(1);
});
