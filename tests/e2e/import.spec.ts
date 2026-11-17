import path from "node:path";
import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";

const FIXTURES = path.resolve("tests/fixtures");

async function createProject(page: import("@playwright/test").Page, title: string) {
  await page.goto("/projects");
  await page.getByLabel("제목").fill(title);
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/, { timeout: 30_000 });
}

async function importFile(page: import("@playwright/test").Page, file: string) {
  await page.getByRole("link", { name: "가져오기", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "파일 가져오기" })).toBeVisible();
  await expect(page.getByText("가져오기는 항상 새 문서를 만듭니다.")).toBeVisible();
  await page.getByLabel("가져올 파일").setInputFiles(path.join(FIXTURES, file));
  await page.getByRole("button", { name: "가져오기" }).click();
  await expect(page.getByRole("status")).toHaveText("가져오기가 끝났어요.", { timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "가져오기 품질 안내" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "원본 미리보기" })).toBeVisible();
}

test.describe("가져오기 (P3-4, P3-5)", () => {
  test("DOCX를 가져오면 품질 안내와 원본 미리보기가 나란히 나오고, 새 문서에서 편집할 수 있다", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, uniqueEmail("import-docx"));
    await createProject(page, "가져오기 프로젝트");
    await importFile(page, "import/sample.docx");
    await expect(page.getByText("DOCX의 글자 크기·색·들여쓰기는 가져오지 않고")).toBeVisible();
    await expect(page.locator('iframe[title="원본 미리보기"]')).toBeVisible();

    await page.getByRole("link", { name: "가져온 문서 열기" }).click();
    await expect(page).toHaveURL(/\/docs\/[a-z0-9]+$/, { timeout: 30_000 });
    const editor = page.getByRole("textbox", { name: "문서 본문" });
    await expect(editor.getByRole("heading", { name: "DOCX 가져오기 샘플" })).toBeVisible();
    await expect(editor.locator("table")).toBeVisible();
    await expect(editor.locator("img")).toHaveAttribute("src", /^\/api\/assets\//);
    await editor.getByText("그림 아래 문단입니다.").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" 편집됨");
    await expect(editor.getByText("그림 아래 문단입니다. 편집됨")).toBeVisible();
  });

  test("Markdown 원본은 그대로 미리보기된다", async ({ page }) => {
    await login(page, uniqueEmail("import-md"));
    await createProject(page, "마크다운 프로젝트");
    await importFile(page, "import/sample.md");
    await expect(page.getByText("Markdown 안의 HTML 태그와 스크립트는 안전을 위해 제거했습니다.")).toBeVisible();
    await expect(page.locator('iframe[title="원본 미리보기"]')).toHaveAttribute("src", /^\/api\/assets\//);
  });

  test("완료 기준: PDF와 HWP 파일을 가져와 편집 가능한 문서가 만들어진다 (P3-5)", async ({ page }) => {
    test.setTimeout(240_000);
    await login(page, uniqueEmail("import-pdf-hwp"));
    await createProject(page, "PDF·HWP 프로젝트");
    const projectUrl = page.url();

    await importFile(page, "import/sample.pdf");
    await expect(page.getByText("PDF는 글자 크기와 위치로 제목·문단·표를 추정합니다.")).toBeVisible();
    await page.getByRole("link", { name: "가져온 문서 열기" }).click();
    await expect(page).toHaveURL(/\/docs\/[a-z0-9]+$/, { timeout: 30_000 });
    let editor = page.getByRole("textbox", { name: "문서 본문" });
    await expect(editor.getByRole("heading", { name: "PDF 가져오기 샘플" })).toBeVisible();
    await expect(editor.locator("table td").first()).toHaveText("시료");

    await page.goto(projectUrl);
    await importFile(page, "hwp/sample.hwpx");
    await expect(page.getByText("HWP/HWPX는 중간 형식으로 바꾼 뒤 가져옵니다.")).toBeVisible();
    await page.getByRole("link", { name: "가져온 문서 열기" }).click();
    await expect(page).toHaveURL(/\/docs\/[a-z0-9]+$/, { timeout: 30_000 });
    editor = page.getByRole("textbox", { name: "문서 본문" });
    await expect(editor.getByText("음향 블랙홀 진동 감쇠 실험 보고서")).toBeVisible();
    await expect(editor.locator("table")).toContainText("감쇠율");
    await editor.getByText("표 아래 문단").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" (수정)");
    await expect(editor.getByText("평균이다. (수정)")).toBeVisible();
  });

  test("스캔 PDF는 '텍스트 추출 불가' 안내와 함께 첨부 파일로만 추가된다", async ({ page }) => {
    await login(page, uniqueEmail("import-scan"));
    await createProject(page, "스캔 프로젝트");
    await importFile(page, "import/scanned.pdf");
    await expect(page.getByText(/텍스트 추출 불가/)).toBeVisible();
    await expect(page.getByText("문서는 만들지 않고, 원본 PDF를 프로젝트 첨부 파일로만 추가했습니다.")).toBeVisible();
    await expect(page.getByRole("link", { name: "가져온 문서 열기" })).toHaveCount(0);
  });
});
