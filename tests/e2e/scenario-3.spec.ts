import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";

const CP949_CSV = readFileSync(path.join(__dirname, "../fixtures/csv/korean-cp949.csv"));

// SPEC 13장 시나리오 3: CSV 업로드 → 산점도 + 추세선 생성 → 문서 삽입 → 캡션 번호 자동 부여
// P4-4: CP949로 저장된 한글 CSV가 깨지지 않고 표·그래프로 만들어진다.
test("E2E-3 CSV 업로드 → 산점도 + 추세선 → 문서 삽입 → 캡션 번호", async ({ page }) => {
  await login(page, uniqueEmail("scenario3"));
  await page.getByLabel("제목").fill("진동 감쇠 데이터");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  // 첫 요청은 dev 서버 컴파일이 끼어 느릴 수 있다.
  await expect(page.getByRole("heading", { level: 1, name: "진동 감쇠 데이터" })).toBeVisible({ timeout: 30_000 });

  // 프로젝트 홈 "데이터" 섹션에서 CP949 CSV 업로드
  const data = page.getByRole("region", { name: "데이터" });
  await expect(data.getByText("아직 올린 데이터가 없습니다.", { exact: false })).toBeVisible();
  await page.getByTestId("dataset-file-input").setInputFiles({ name: "진동 측정.csv", mimeType: "text/csv", buffer: CP949_CSV });
  await expect(data.getByRole("status")).toContainText('"진동 측정" 데이터를 올렸습니다. (5행, CP949(EUC-KR))');
  await expect(data.getByText("5행 · 4열")).toBeVisible();
  await data.getByRole("button", { name: "미리보기" }).click();
  const preview = data.getByRole("table", { name: '"진동 측정" 미리보기' });
  await expect(preview).toContainText("감쇠 구간");
  await expect(preview.getByRole("columnheader").nth(1)).toContainText("진폭");
  await expect(preview).not.toContainText("�");

  // 새 문서에서 그래프 만들기
  await page.getByRole("button", { name: "새 문서" }).click();
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await expect(body).toBeVisible({ timeout: 30_000 });
  await body.click();
  await page.keyboard.type("측정 결과는 다음과 같다.");

  await page.getByRole("button", { name: "그래프 만들기" }).click();
  const builder = page.getByTestId("chart-builder");
  await expect(builder).toBeVisible();
  await expect(builder.getByLabel("유형")).toHaveValue("scatter");
  await expect(builder.getByLabel("X 열")).toHaveValue("시간(s)");
  await expect(builder.getByLabel("Y 열")).toHaveValue("진폭");
  await builder.getByLabel("추세선 (선형 회귀)").check();
  // 추세선·R²는 코드로 계산한 값 (lib/csv/stats.ts)
  await expect(builder.getByTestId("chart-stats")).toContainText("y = -1.7x + 12.08, R² = 0.9827 (n = 5)");
  await expect(builder.getByTestId("chart-preview").locator("svg.main-svg").first()).toBeVisible({ timeout: 15_000 });
  await expect(builder.getByTestId("chart-preview")).toContainText("(mm)");

  // caption 노드가 병합됐으므로 캡션 자동 삽입을 반드시 검사한다 (조건부로 건너뛰지 않는다).
  await expect(builder.getByText("번호(그림 1., 표 1.)는 문서 순서에 따라 자동으로 붙습니다.")).toBeVisible();
  await builder.getByRole("button", { name: "그래프 삽입" }).click();
  await expect(page.getByText("문서에 넣었습니다.")).toBeVisible();

  const chart = body.locator("img[data-dataset-id]");
  await expect(chart).toHaveCount(1);
  await expect(chart).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await expect(chart).toHaveAttribute("alt", "시간(s)에 따른 진폭");

  // 같은 데이터로 표도 만들어 넣는다 (CP949 한글이 표에서도 깨지지 않음)
  await page.getByRole("button", { name: "표 만들기" }).click();
  const tableBuilder = page.getByTestId("table-builder");
  await tableBuilder.getByLabel("소수 자릿수").selectOption("1");
  await tableBuilder.getByRole("button", { name: "표 삽입" }).click();
  const docTable = body.locator("table");
  await expect(docTable).toHaveCount(1);
  await expect(docTable).toContainText("진폭 (mm)");
  await expect(docTable).toContainText("감쇠 구간");
  await expect(docTable).toContainText("12.5");
  await expect(chart).toHaveCount(1); // 선택돼 있던 그림을 표가 덮어쓰지 않는다

  // 캡션 번호 자동 부여: 그래프 아래 "그림 1.", 표 위 "표 1.", 그래프를 더 넣으면 "그림 2."
  const figureCaptions = body.locator('p[data-type="caption"][data-kind="figure"]');
  await expect(figureCaptions.first()).toContainText(/^그림 1\./);
  await expect(body).toContainText("시간(s)에 따른 진폭");
  await expect(body.locator('p[data-type="caption"][data-kind="table"]').first()).toContainText(/^표 1\./);
  await page.getByRole("button", { name: "그래프 만들기" }).click();
  await page.getByTestId("chart-builder").getByLabel("유형").selectOption("histogram");
  await page.getByTestId("chart-builder").getByRole("button", { name: "그래프 삽입" }).click();
  await expect(body.locator("img[data-dataset-id]")).toHaveCount(2);
  await expect(figureCaptions).toHaveCount(2);
  await expect(figureCaptions.nth(1)).toContainText(/^그림 2\./);

  // 저장 후 새로고침해도 Dataset 연결이 남고, 더블클릭하면 설정을 다시 편집한다.
  await expect(page.getByTestId("save-status")).toContainText(/저장됨 \d{2}:\d{2}/, { timeout: 8000 });
  await page.reload();
  const saved = page.getByRole("textbox", { name: "문서 본문" }).locator("img[data-dataset-id]").first();
  await expect(saved).toBeVisible();
  const chartsBefore = await page.getByRole("textbox", { name: "문서 본문" }).locator("img[data-dataset-id]").count();
  await saved.dblclick();
  await expect(page.getByRole("heading", { name: "그래프 설정 다시 편집" })).toBeVisible();
  const editor = page.getByTestId("chart-builder");
  await expect(editor.getByLabel("추세선 (선형 회귀)")).toBeChecked();
  await expect(editor.getByTestId("chart-stats")).toContainText("R² = 0.9827");
  await editor.getByLabel("Y축 제목").fill("진폭");
  await editor.getByRole("button", { name: "그래프 바꾸기" }).click();
  await expect(page.getByText("문서에 넣었습니다.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "문서 본문" }).locator("img[data-dataset-id]")).toHaveCount(chartsBefore);
});

test("E2E-3 그래프 추천 API가 없으면 안내 문구, PNG 삽입은 자산으로 연결", async ({ page }) => {
  await login(page, uniqueEmail("scenario3b"));
  await page.getByLabel("제목").fill("추천 확인");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "추천 확인" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("dataset-file-input").setInputFiles({ name: "a.csv", mimeType: "text/csv", buffer: CP949_CSV });
  await expect(page.getByText("5행 · 4열")).toBeVisible();
  await page.getByRole("button", { name: "새 문서" }).click();
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toBeVisible({ timeout: 30_000 });
  await page.route("**/api/ai/chart-suggest", (route) => route.fulfill({ status: 503, json: { error: { code: "AI_UNAVAILABLE", message: "x" } } }));
  await page.getByRole("button", { name: "그래프 만들기" }).click();
  await page.getByRole("button", { name: "이 데이터에 맞는 그래프 추천" }).click();
  await expect(page.getByText("지금은 그래프 추천을 쓸 수 없어요. 유형과 열을 직접 골라 주세요.")).toBeVisible();

  // PNG로 넣으면 자산으로 올라가 자산 URL로 연결된다.
  const builder = page.getByTestId("chart-builder");
  await builder.getByLabel("유형").selectOption("box");
  await builder.getByRole("radio", { name: "PNG" }).check();
  await builder.getByRole("button", { name: "그래프 삽입" }).click();
  const img = page.getByRole("textbox", { name: "문서 본문" }).locator("img[data-dataset-id]");
  await expect(img).toHaveAttribute("src", /^\/api\/assets\/[a-z0-9]+$/, { timeout: 15_000 });
  await expect(img).toHaveAttribute("alt", "진폭의 분포");
});
