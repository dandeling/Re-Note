import { expect, test } from "@playwright/test";
import { uniqueEmail } from "./helpers";

// SPEC 13장 시나리오 1 / 7.5 완료 기준 "입력 후 새로고침해도 내용이 유지된다"
test("E2E-1 가입 → 프로젝트 생성 → 문서 작성 → 새로고침 후 내용 유지", async ({ page }) => {
  // 가입(첫 로그인)
  await page.goto("/");
  await page.getByRole("link", { name: "로그인" }).click();
  await page.locator("#test-email").fill(uniqueEmail("scenario1"));
  await page.getByRole("button", { name: "테스트 계정으로 로그인" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  // 프로젝트 생성
  await page.getByLabel("제목").fill("음향 블랙홀 진동 감쇠");
  await page.getByLabel("키워드").fill("음향 블랙홀, 진동 감쇠");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "음향 블랙홀 진동 감쇠" })).toBeVisible();

  // 문서 작성 (자동 저장)
  await page.getByRole("button", { name: "새 문서" }).click();
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await body.click();
  await page.getByLabel("문서 제목").fill("1차 실험 보고서");
  await body.click();
  await page.keyboard.type("빔 끝단의 두께를 줄이면 반사파가 줄어든다.");
  await expect(page.getByTestId("save-status")).toContainText(/저장됨 \d{2}:\d{2}/, { timeout: 8000 });

  // 새로고침 후 유지
  await page.reload();
  await expect(page.getByLabel("문서 제목")).toHaveValue("1차 실험 보고서");
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toHaveText("빔 끝단의 두께를 줄이면 반사파가 줄어든다.");
});
