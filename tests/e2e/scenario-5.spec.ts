import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";

// SPEC 13장 시나리오 5 / 7.2:
// 연구 공개(요약·한계·결과보고서) → 다른 계정이 키워드 검색 → 연구 상세에서 고충·한계·보고서 확인

async function createProject(page: Page, title: string, keywords: string) {
  await page.goto("/projects");
  await page.getByLabel("제목").fill(title);
  await page.getByLabel("설명").fill("물 로켓 노즐 지름을 바꿔 가며 최고 고도를 측정했다.");
  await page.getByLabel("키워드").fill(keywords);
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/, { timeout: 30_000 });
  return page.url().split("/").pop()!;
}

async function openPublishForm(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("link", { name: "연구 공개하기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "연구 공개하기" })).toBeVisible({ timeout: 30_000 });
}

async function confirmPublish(page: Page, reportFilename: string) {
  await page.getByRole("button", { name: "공개 전 확인" }).click();
  const dialog = page.getByRole("dialog", { name: "이 연구를 공개할까요?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(reportFilename);
  await dialog.getByRole("button", { name: "공개하기" }).click();
  await expect(page).toHaveURL(/\/research\/[a-z0-9]+$/, { timeout: 30_000 });
  return page.url().split("/").pop()!;
}

/** 연구 상세의 보고서 뷰어(iframe)가 PDF를 가리키고, 다운로드 버튼으로 PDF가 내려받아지는지 확인 */
async function expectReport(page: Page, researchId: string, filename: string) {
  const report = page.getByRole("region", { name: "결과보고서" });
  const viewer = report.locator("iframe");
  await expect(viewer).toHaveAttribute("title", "결과보고서 PDF 미리보기");
  await expect(viewer).toHaveAttribute("src", `/api/research/${researchId}/report`);
  const inline = await page.request.get(`/api/research/${researchId}/report`);
  expect(inline.status()).toBe(200);
  expect(inline.headers()["content-type"]).toBe("application/pdf");
  expect(inline.headers()["content-disposition"]).toMatch(/^inline;/);

  // 헤드리스 Chromium에는 PDF 뷰어가 없어 iframe의 인라인 PDF도 다운로드 이벤트를 낸다. 버튼으로 받은 것만 고른다.
  const [download] = await Promise.all([
    page.waitForEvent("download", (d) => d.url().endsWith("?download=1")),
    report.getByRole("link", { name: "PDF 다운로드" }).click(),
  ]);
  // 이 환경의 헤드리스 Chromium은 한글 파일 이름을 "download"로 바꾸므로, 파일 이름은 응답 헤더(RFC 5987)로 확인한다.
  if (/^[\x20-\x7e]+$/.test(filename)) expect(download.suggestedFilename()).toBe(filename);
  const attachment = await page.request.get(download.url());
  expect(attachment.headers()["content-disposition"]).toContain(`filename*=UTF-8''${encodeURIComponent(filename)}`);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  return bytes;
}

test("E2E-5 연구 공개(요약·한계·문서에서 만든 결과보고서) → 다른 계정이 검색 → 상세에서 고충·한계·보고서 확인", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const tag = `${Date.now()}`;
  const title = `물 로켓 노즐 지름과 최고 고도 ${tag}`;
  const authorEmail = uniqueEmail("s5-author");
  const limitations = "바람이 없는 날을 고르지 못해 고도 편차가 컸다.";

  // 1) 작성자: 프로젝트 → 결과보고서 문서 작성(자동 저장)
  await login(page, authorEmail);
  const projectId = await createProject(page, title, "물 로켓, 노즐 지름");
  await page.getByRole("button", { name: "새 문서" }).click();
  await expect(page).toHaveURL(/\/docs\/[a-z0-9]+$/, { timeout: 30_000 });
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await body.click();
  await page.getByLabel("문서 제목").fill("물 로켓 결과보고서");
  await body.click();
  await page.keyboard.type("노즐 지름 9 mm에서 최고 고도 41 m를 기록했다.");
  await expect(page.getByTestId("save-status")).toContainText(/저장됨 \d{2}:\d{2}/, { timeout: 15_000 });

  // 2) 연구 공개하기: 한계 입력 + 결과보고서는 "문서를 PDF로 내보내기"
  await openPublishForm(page, projectId);
  await expect(page.getByLabel("요약")).toHaveValue(/노즐 지름/);
  await page.getByLabel("한계").fill(limitations);
  await page.getByRole("radio", { name: "문서를 PDF로 내보내기" }).check();
  await expect(page.getByLabel("내보낼 문서")).toHaveValue(/.+/);
  await page.getByRole("button", { name: "PDF로 만들기" }).click();
  await expect(page.getByTestId("report-attached")).toHaveText("연결된 보고서: 물 로켓 결과보고서.pdf", { timeout: 60_000 });
  const researchId = await confirmPublish(page, "물 로켓 결과보고서.pdf");

  // 3) 작성자가 이 연구에 연결한 고충을 올린다
  const painTitle = `발사대 고무마개가 압력을 못 버텨요 ${tag}`;
  await page.goto("/pains/new");
  await page.getByLabel("제목").fill(painTitle);
  await page.getByLabel("본문").fill("2기압을 넘기면 마개가 먼저 빠집니다.");
  await page.getByLabel("연결할 공개 연구 (선택)").selectOption({ label: title });
  await page.getByRole("button", { name: "올리기" }).click();
  await expect(page).toHaveURL(/\/pains\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  const painPath = new URL(page.url()).pathname;

  // 4) 다른 계정: 키워드(띄어쓰기 차이) 검색 → 카드 배지 확인
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await login(page2, uniqueEmail("s5-reader"));
  await page2.goto("/");
  await page2.getByLabel("사이트 내 검색어").fill(`물로켓 노즐지름 ${tag}`);
  await page2.getByRole("button", { name: "검색" }).click();
  await expect(page2).toHaveURL(/\/explore\?q=/, { timeout: 30_000 });
  const card = page2.getByTestId("research-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByText("고충 1건")).toBeVisible();
  await expect(card.getByText("결과보고서 있음")).toBeVisible();
  await expect(card.getByText(`한계: ${limitations}`)).toBeVisible();
  await card.getByRole("link", { name: title }).click();

  // 5) 연구 상세: 한계·고충·보고서를 한 화면에서
  await expect(page2).toHaveURL(`/research/${researchId}`, { timeout: 30_000 });
  await expect(page2.getByRole("region", { name: "요약" })).toContainText("노즐 지름");
  await expect(page2.getByRole("region", { name: "한계" })).toContainText(limitations);
  await expect(page2.getByRole("heading", { name: "연결된 고충 1건" })).toBeVisible();
  await expect(page2.getByTestId("research-pains").getByRole("link", { name: painTitle })).toHaveAttribute("href", painPath);
  await expect(page2.getByText(authorEmail)).toHaveCount(0);
  await expectReport(page2, researchId, "물 로켓 결과보고서.pdf");
  await other.close();

  // 비로그인도 공개 연구의 보고서를 받을 수 있다.
  const anon = await browser.newContext();
  const res = await anon.request.get(`/api/research/${researchId}/report?download=1`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toMatch(/^attachment;/);
  await anon.close();
});

test("E2E-5 결과보고서로 PDF 파일을 올려 공개하면 상세 화면에서 같은 파일을 내려받는다", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const tag = `${Date.now()}`;
  const title = `물 로켓 물 양에 따른 비행 시간 ${tag}`;
  await login(page, uniqueEmail("s5-uploader"));
  const projectId = await createProject(page, title, "물 로켓, 비행 시간");

  await openPublishForm(page, projectId);
  await page.getByRole("radio", { name: "PDF 파일 올리기" }).check();
  // PDF가 아닌 파일은 거절한다.
  await page.getByLabel("PDF 파일", { exact: true }).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByRole("alert").filter({ hasText: "PDF 파일만" })).toHaveText("PDF 파일만 연결할 수 있어요.");
  const pdfPath = path.join(__dirname, "../fixtures/import/sample.pdf");
  await page.getByLabel("PDF 파일", { exact: true }).setInputFiles(pdfPath);
  await expect(page.getByTestId("report-attached")).toHaveText("연결된 보고서: sample.pdf", { timeout: 30_000 });
  const researchId = await confirmPublish(page, "sample.pdf");

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto(`/research/${researchId}`);
  const bytes = await expectReport(page2, researchId, "sample.pdf");
  expect(bytes.equals(await readFile(pdfPath))).toBe(true);
  await other.close();
});
