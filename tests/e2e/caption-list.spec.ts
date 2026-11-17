import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";
import { image, openNewDoc, paragraph, savedContent, seedDocument, waitSaved } from "./report-helpers";

test("그림 목차·표 목차를 넣으면 캡션에서 자동으로 만들어지고, 캡션이 바뀌면 따라 바뀐다", async ({ page }) => {
  await login(page, uniqueEmail("toc"));
  await openNewDoc(page);
  await seedDocument(page, [paragraph("목차 자리"), image("A"), image("B"), paragraph("끝")]);
  const body = page.getByRole("textbox", { name: "문서 본문" });
  const figureList = body.locator('[data-type="caption-list"][data-kind="figure"]');
  const tableList = body.locator('[data-type="caption-list"][data-kind="table"]');

  // 캡션이 없을 때 넣으면 빈 목차
  await body.getByText("목차 자리").click();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "그림 목차 넣기" }).click();
  await expect(figureList).toContainText("그림 목차");
  await expect(figureList.locator("li")).toHaveText(["아직 항목이 없습니다."]);

  // 캡션을 넣으면 목차에 바로 나타난다.
  await body.locator("img").nth(0).click();
  await page.keyboard.press("ControlOrMeta+Shift+C");
  await page.keyboard.type("실험 장치");
  await body.locator("img").nth(1).click();
  await page.keyboard.press("ControlOrMeta+Shift+C");
  await page.keyboard.type("감쇠 곡선");
  await expect(figureList.locator("li")).toHaveText(["그림 1. 실험 장치", "그림 2. 감쇠 곡선"]);

  // 표 목차는 표 캡션만 모은다.
  await body.getByText("끝").click();
  await page.getByRole("button", { name: "표 삽입" }).click();
  await page.keyboard.press("ControlOrMeta+Shift+C");
  await page.keyboard.type("측정 조건");
  await body.getByText("끝").click();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "표 목차 넣기" }).click();
  await expect(tableList.locator("li")).toHaveText(["표 1. 측정 조건"]);
  await expect(figureList.locator("li")).toHaveCount(2);

  // 첫 그림을 지우면 목차가 줄고 번호가 당겨진다.
  await body.locator("img").nth(0).click();
  await page.keyboard.press("Delete");
  await expect(figureList.locator("li")).toHaveText(["그림 1. 감쇠 곡선"]);

  // 목차 내용은 저장하지 않는다(kind만). 다시 열어도 같은 목차.
  await waitSaved(page);
  const saved = await savedContent(page);
  expect(saved.content.filter((n) => n.type === "captionList")).toEqual([
    { type: "captionList", attrs: { kind: "figure" } },
    { type: "captionList", attrs: { kind: "table" } },
  ]);
  await page.reload();
  await expect(figureList.locator("li")).toHaveText(["그림 1. 감쇠 곡선"]);
  await expect(tableList.locator("li")).toHaveText(["표 1. 측정 조건"]);
});
