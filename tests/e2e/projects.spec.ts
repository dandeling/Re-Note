import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";

test("프로젝트를 만들고 목록·홈에서 확인하고 수정한다", async ({ page }) => {
  await login(page, uniqueEmail("proj"));
  await page.goto("/projects");
  await expect(page.getByText("아직 프로젝트가 없어요")).toBeVisible();

  await page.getByLabel("제목").fill("음향 블랙홀 연구");
  await page.getByLabel("설명").fill("진동 감쇠 측정");
  await page.getByLabel("키워드").fill("음향 블랙홀, 진동 감쇠");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();

  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "음향 블랙홀 연구" })).toBeVisible();
  await expect(page.getByText("비공개")).toBeVisible();

  await page.getByLabel("제목").fill("음향 블랙홀 연구 v2");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "음향 블랙홀 연구 v2" })).toBeVisible();

  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "음향 블랙홀 연구 v2" })).toBeVisible();
});

test("프로젝트를 삭제하면 휴지통으로 가고 복구할 수 있다", async ({ page }) => {
  await login(page, uniqueEmail("trash"));
  await page.goto("/projects");
  await page.getByLabel("제목").fill("지웠다 살릴 프로젝트");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "삭제" }).click();
  await expect(page).toHaveURL(/status=trash/);
  await expect(page.getByText("지웠다 살릴 프로젝트")).toBeVisible();
  await expect(page.getByText(/영구 삭제 예정/)).toBeVisible();

  await page.getByRole("button", { name: "복구" }).click();
  await expect(page.getByText("휴지통이 비어 있어요.")).toBeVisible();
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "지웠다 살릴 프로젝트" })).toBeVisible();
});
