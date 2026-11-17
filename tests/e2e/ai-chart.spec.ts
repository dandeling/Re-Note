import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";

const CP949_CSV = readFileSync(path.join(__dirname, "../fixtures/csv/korean-cp949.csv"));

// E2E 서버는 AI_FAKE=1: 그래프 추천은 숫자 열 두 개면 산점도 + 추세선을 낸다 (lib/ai/fake.ts).

async function projectWithCsvAndDoc(page: Page, title: string) {
  await page.getByLabel("제목").fill(title);
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("dataset-file-input").setInputFiles({ name: "진동 측정.csv", mimeType: "text/csv", buffer: CP949_CSV });
  await expect(page.getByText("5행 · 4열")).toBeVisible();
  await page.getByRole("button", { name: "새 문서" }).click();
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toBeVisible({ timeout: 30_000 });
}

test("\"이 데이터에 맞는 그래프 추천\" → 유형·축 구성만 폼에 적용되고 그리기는 원본 데이터로 한다 (SPEC 7.3 (e))", async ({ page }) => {
  await login(page, uniqueEmail("ai-chart"));
  await projectWithCsvAndDoc(page, "그래프 추천");
  await page.getByRole("button", { name: "그래프 만들기" }).click();
  const builder = page.getByTestId("chart-builder");
  await builder.getByLabel("유형").selectOption("bar");

  const request = page.waitForRequest("**/api/ai/chart-suggest");
  await builder.getByRole("button", { name: "이 데이터에 맞는 그래프 추천" }).click();
  // 요청에는 데이터셋 ID만 담긴다 (행 데이터는 보내지 않는다)
  expect(Object.keys((await request).postDataJSON())).toEqual(["datasetId"]);
  await expect(builder.getByRole("status")).toContainText("추천을 적용했습니다.");
  await expect(builder.getByRole("status")).toContainText("산점도가 알맞습니다");
  await expect(builder.getByLabel("유형")).toHaveValue("scatter");
  await expect(builder.getByLabel("X 열")).toHaveValue("시간(s)");
  await expect(builder.getByLabel("Y 열")).toHaveValue("진폭");
  await expect(builder.getByLabel("추세선 (선형 회귀)")).toBeChecked();
  await expect(builder.getByLabel("Y축 단위")).toHaveValue("mm");
  // 추세선·R²는 코드로 계산한 값 (AI가 만든 수치가 아니다)
  await expect(builder.getByTestId("chart-stats")).toContainText("R² = 0.9827 (n = 5)");
});

test("에디터 AI 도우미의 그래프 추천 → 삽입을 누르면 그래프 만들기가 그 추천으로 열리고, 문서는 사용자가 넣을 때만 바뀐다", async ({ page }) => {
  await login(page, uniqueEmail("ai-chart-chat"));
  await projectWithCsvAndDoc(page, "챗봇 그래프 추천");
  const body = page.getByRole("textbox", { name: "문서 본문" });

  await page.getByRole("button", { name: "AI 도우미", exact: true }).click();
  const panel = page.getByTestId("editor-chat");
  await panel.getByLabel("AI 도우미에게 보낼 메시지").fill("이 데이터로 그래프 추천해줘");
  await panel.getByLabel("AI 도우미에게 보낼 메시지").press("Enter");
  const card = panel.locator('li[data-role="assistant"]').last().getByTestId("chat-suggestion");
  await expect(card).toContainText("그래프 추천: 산점도");
  await expect(card).toContainText("X: 시간(s) · Y: 진폭");
  await expect(page.getByTestId("chart-builder")).toHaveCount(0);

  await card.getByRole("button", { name: "삽입" }).click();
  const builder = page.getByTestId("chart-builder");
  await expect(builder).toBeVisible();
  await expect(builder.getByRole("status")).toContainText("AI 도우미의 추천으로 설정을 채웠습니다.");
  await expect(builder.getByLabel("유형")).toHaveValue("scatter");
  await expect(builder.getByLabel("추세선 (선형 회귀)")).toBeChecked();
  await expect(builder.getByTestId("chart-stats")).toContainText("R² = 0.9827 (n = 5)");
  await expect(body.locator("img[data-dataset-id]")).toHaveCount(0);

  await builder.getByRole("button", { name: "그래프 삽입" }).click();
  await expect(body.locator("img[data-dataset-id]")).toHaveCount(1);
});
