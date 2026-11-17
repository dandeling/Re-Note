import { expect, type Page } from "@playwright/test";

/** 테스트 로그인(AUTH_TEST_MODE=1)으로 로그인한다. */
export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#test-email").fill(email);
  await page.getByRole("button", { name: "테스트 계정으로 로그인" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** 프로젝트와 문서를 만들고 에디터 화면까지 이동한다. */
export async function createProjectAndDoc(page: Page, title = "에디터 테스트 프로젝트") {
  await page.goto("/projects");
  await page.getByLabel("제목").fill(title);
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);
  await page.getByRole("button", { name: "새 문서" }).click();
  await expect(page).toHaveURL(/\/docs\/[a-z0-9]+$/);
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toBeVisible();
}
