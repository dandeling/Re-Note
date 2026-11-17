import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";

test("설정에서 이름을 바꾸고 로그인 이메일을 본다", async ({ page }) => {
  const email = uniqueEmail("settings");
  await login(page, email);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "설정" })).toBeVisible();
  await expect(page.getByLabel("로그인 이메일", { exact: true })).toHaveValue(email);

  await page.getByLabel("이름", { exact: true }).fill("설정 테스트 사용자");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByTestId("settings-profile-result")).toHaveText("이름을 저장했어요.");
  await page.reload();
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("설정 테스트 사용자");
});

test("이메일을 다시 입력해야 계정을 삭제할 수 있고, 삭제 후 로그아웃된다", async ({ page }) => {
  const email = uniqueEmail("delete");
  await login(page, email);
  await page.goto("/projects");
  await page.getByLabel("제목").fill("삭제될 프로젝트");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);

  await page.goto("/settings");
  const confirm = page.getByLabel(/로그인 이메일\(.+\)을 다시 입력/);
  const button = page.getByRole("button", { name: "계정과 모든 데이터 삭제" });
  await expect(button).toBeDisabled();
  await confirm.fill("someone-else@example.com");
  await expect(button).toBeDisabled();
  await confirm.fill(email);
  await expect(button).toBeEnabled();
  await button.click();

  await expect(page).toHaveURL(/\/$/);
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login/);

  // 같은 이메일로 다시 로그인하면 새 계정이다: 예전 프로젝트는 없다.
  await login(page, email);
  await page.goto("/projects");
  await expect(page.getByText("아직 프로젝트가 없어요")).toBeVisible();
});
