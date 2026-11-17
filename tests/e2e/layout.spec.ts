import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";

test("기본 레이아웃: 헤더 메뉴와 통합 검색창이 보인다", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "주요 메뉴" });
  for (const name of ["연구 탐색", "고충 게시판", "내 프로젝트", "한글 파일 열기"]) {
    await expect(nav.getByRole("link", { name })).toBeVisible();
  }
  await expect(page.getByRole("search")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});

test("홈: 제목 한 줄 + 통합 검색 + 실제 개수 + 바로 가기 3개", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "비슷한 연구를 찾고, 막힌 점을 나눠요" })).toBeVisible();
  await expect(page.locator("h1 mark")).toHaveText("막힌 점");
  await expect(page.getByTestId("home-stats")).toHaveText(/^연구 \d+건 · 고충 \d+건$/);
  const shortcuts = page.getByRole("navigation", { name: "바로 가기" });
  await expect(shortcuts.getByRole("link")).toHaveCount(3);
  await page.getByLabel("사이트 내 검색어").fill("음향 블랙홀");
  await page.getByRole("button", { name: "검색" }).click();
  await expect(page).toHaveURL(/\/explore\?q=/);
});

test("비로그인으로 /projects에 가면 로그인으로 이동하고, 로그인하면 돌아온다", async ({ page }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fprojects/);
  await page.locator("#test-email").fill(uniqueEmail("layout"));
  await page.getByRole("button", { name: "테스트 계정으로 로그인" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
});

test("로그아웃하면 로그인 버튼이 다시 보인다", async ({ page }) => {
  await login(page, uniqueEmail("logout"));
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("link", { name: "로그인" })).toBeVisible();
});

test("없는 주소는 한국어 404를 보여준다", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없어요" })).toBeVisible();
});
