import { expect, test, type Page } from "@playwright/test";
import { createProjectAndDoc, login, uniqueEmail } from "./helpers";

const body = (page: Page) => page.getByRole("textbox", { name: "문서 본문" });
const status = (page: Page) => page.getByTestId("save-status");

// SPEC 7.5 완료 기준: 오프라인에서 작성 후 온라인 복귀 시 자동 동기화된다
test("오프라인에서 작성하면 '오프라인'으로 표시되고, 온라인으로 돌아오면 자동으로 저장된다", async ({ page, context }) => {
  await login(page, uniqueEmail("offline"));
  await createProjectAndDoc(page);

  await context.setOffline(true);
  await body(page).click();
  await page.keyboard.type("오프라인에서 쓴 문장");
  await expect(status(page)).toContainText("오프라인", { timeout: 8000 });

  await context.setOffline(false);
  await expect(status(page)).toContainText(/저장됨 \d{2}:\d{2}/, { timeout: 8000 });

  // 서버에 실제로 저장됐는지: 초안이 없는 새 브라우저 컨텍스트 대신 API로 확인
  const docId = page.url().split("/").pop();
  const res = await page.request.get(`/api/docs/${docId}`);
  expect(JSON.stringify((await res.json()).document.contentJson)).toContain("오프라인에서 쓴 문장");
});

test("오프라인에서 쓰고 탭을 닫아도, 다시 열면 로컬 초안 복구를 제안하고 복구하면 서버에 저장된다", async ({ page, context }) => {
  await login(page, uniqueEmail("draft"));
  await createProjectAndDoc(page);
  const url = page.url();

  await context.setOffline(true);
  await body(page).click();
  await page.keyboard.type("탭을 닫기 전에 쓴 문장");
  await expect(status(page)).toContainText("오프라인", { timeout: 8000 });
  await page.waitForTimeout(500); // 로컬 초안 기록(300ms 디바운스)을 기다린다
  await page.close();

  await context.setOffline(false);
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(body(reopened)).toHaveText("");
  await expect(reopened.getByTestId("draft-banner")).toContainText("저장되지 않은 초안이 있어요");
  await reopened.getByRole("button", { name: "초안 복구" }).click();
  await expect(body(reopened)).toHaveText("탭을 닫기 전에 쓴 문장");
  await expect(status(reopened)).toContainText(/저장됨 \d{2}:\d{2}/, { timeout: 8000 });

  await reopened.reload();
  await expect(body(reopened)).toHaveText("탭을 닫기 전에 쓴 문장");
  await expect(reopened.getByTestId("draft-banner")).toHaveCount(0);
});

test("초안을 버리면 서버 내용이 유지되고 다시 묻지 않는다", async ({ page, context }) => {
  await login(page, uniqueEmail("discard"));
  await createProjectAndDoc(page);
  const url = page.url();
  await body(page).click();
  await page.keyboard.type("저장된 문장");
  await expect(status(page)).toContainText(/저장됨/, { timeout: 8000 });

  await context.setOffline(true);
  await page.keyboard.type(" + 버릴 문장");
  await expect(status(page)).toContainText("오프라인", { timeout: 8000 });
  await page.waitForTimeout(500); // 로컬 초안 기록(300ms 디바운스)을 기다린다
  await page.close();
  await context.setOffline(false);

  const reopened = await context.newPage();
  await reopened.goto(url);
  await reopened.getByRole("button", { name: "버리기" }).click();
  await expect(body(reopened)).toHaveText("저장된 문장");
  await reopened.reload();
  await expect(reopened.getByTestId("draft-banner")).toHaveCount(0);
  await expect(body(reopened)).toHaveText("저장된 문장");
});

test("자동 저장(2초)을 기다리지 않고 바로 새로고침해도 내용을 잃지 않는다", async ({ page }) => {
  await login(page, uniqueEmail("quick"));
  await createProjectAndDoc(page);
  await body(page).click();
  await page.keyboard.type("저장 표시가 뜨기 전에 새로고침한 문장");
  await expect(status(page)).toHaveText("변경됨");
  await page.waitForTimeout(400); // 로컬 초안 기록(300ms)

  page.on("dialog", (d) => d.accept());
  await page.reload();
  // 탭 종료 시 보낸 저장이 먼저 반영됐으면 그대로 보이고, 아니면 초안 복구를 제안한다.
  const banner = page.getByTestId("draft-banner");
  await expect(body(page).or(banner).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  if (await banner.isVisible()) await page.getByRole("button", { name: "초안 복구" }).click();
  await expect(body(page)).toHaveText("저장 표시가 뜨기 전에 새로고침한 문장");
});
