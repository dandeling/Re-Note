import { expect, test } from "@playwright/test";
import { createProjectAndDoc, login, uniqueEmail } from "./helpers";

test("버전 저장 후 내용을 바꿨다가 버전 기록에서 복원한다", async ({ page }) => {
  await login(page, uniqueEmail("snap"));
  await createProjectAndDoc(page);
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await body.click();
  await page.keyboard.type("보존할 내용");
  await page.getByRole("button", { name: "버전 저장" }).click();
  await expect(page.getByTestId("editor-notice")).toHaveText("버전을 저장했어요.");

  await body.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("실수로 덮어쓴 내용");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("save-status")).toContainText("저장됨");

  await page.getByRole("button", { name: "버전 기록" }).click();
  const manual = page.getByTestId("snapshot-list").getByRole("listitem").filter({ hasText: "수동" });
  await expect(manual).toHaveCount(1);
  page.once("dialog", (d) => d.accept());
  await manual.getByRole("button", { name: "복원" }).click();
  await expect(body).toHaveText("보존할 내용");
  await expect(page.getByTestId("editor-notice")).toHaveText("선택한 버전으로 복원했어요.");

  await page.reload();
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toHaveText("보존할 내용");
});
