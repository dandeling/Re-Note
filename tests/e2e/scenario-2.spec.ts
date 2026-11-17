import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";
import { docId, image, paragraph } from "./report-helpers";

const FIXTURES = path.resolve("tests/fixtures");

/** 웹 서버(같은 PATH·환경변수를 물려받는다)가 HWP 가져오기 엔진(unhwp 또는 pyhwp hwp5html)을 쓸 수 있는지 */
function hasHwpImportEngine() {
  const ok = (cmd: string, args: string[]) => {
    try {
      execFileSync(cmd, args, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  };
  return (
    ok(process.env.UNHWP_PYTHON || "python3", ["-c", "import unhwp"]) ||
    ok("sh", ["-c", `command -v ${process.env.HWP5HTML_BIN || "hwp5html"}`])
  );
}

const HAS_POPPLER = (() => {
  try {
    execFileSync("sh", ["-c", "command -v pdfinfo && command -v pdffonts && command -v pdftotext"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

/** 가져온 문서 끝에 그림 하나와 문단을 붙인다. 에디터에 그림 업로드 UI가 없어 captions.spec.ts처럼 문서 API로 넣는다. */
async function appendImage(page: Page, label: string) {
  const res = await page.request.get(`/api/docs/${docId(page)}`);
  expect(res.ok()).toBe(true);
  const { document } = (await res.json()) as { document: { version: number; contentJson: { type: string; content: unknown[] } } };
  const content = [...document.contentJson.content, image(label), paragraph("그림 아래 설명 문단")];
  const patch = await page.request.patch(`/api/docs/${docId(page)}`, {
    data: { contentJson: { type: "doc", content }, baseVersion: document.version },
  });
  expect(patch.ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toBeVisible({ timeout: 30_000 });
}

// SPEC 13장 시나리오 2: HWP 파일 가져오기 → 서식 템플릿 적용 → 그림 캡션 추가 → PDF 내보내기
test("E2E-2 HWP 가져오기 → 서식 템플릿 적용 → 그림 캡션 추가 → PDF 내보내기", async ({ page }, testInfo) => {
  test.skip(!hasHwpImportEngine(), "HWP 가져오기 엔진(unhwp 또는 pyhwp hwp5html)이 없어 HWP를 가져올 수 없다");
  test.skip(!HAS_POPPLER, "PDF 검사 도구(poppler: pdfinfo·pdffonts·pdftotext)가 없다");
  test.setTimeout(300_000);

  await login(page, uniqueEmail("scenario2"));

  // 1) 프로젝트를 만들고 HWP 파일을 가져온다 (import.spec.ts와 같은 경로)
  await page.goto("/projects");
  await page.getByLabel("제목").fill("음향 블랙홀 보고서");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByRole("link", { name: "가져오기", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "파일 가져오기" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("가져올 파일").setInputFiles(path.join(FIXTURES, "hwp/sample.hwp"));
  await page.getByRole("button", { name: "가져오기" }).click();
  await expect(page.getByRole("status")).toHaveText("가져오기가 끝났어요.", { timeout: 120_000 });
  await expect(page.getByText("HWP/HWPX는 중간 형식으로 바꾼 뒤 가져옵니다.")).toBeVisible();
  await page.getByRole("link", { name: "가져온 문서 열기" }).click();
  await expect(page).toHaveURL(/\/docs\/[a-z0-9]+$/, { timeout: 30_000 });
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await expect(body.getByText("음향 블랙홀 진동 감쇠 실험 보고서")).toBeVisible({ timeout: 30_000 });
  await expect(body.locator("table")).toContainText("감쇠율");

  // 2) 가져온 문서에는 그림이 없으므로 그림 하나를 넣는다
  await expect(body.locator("img")).toHaveCount(0);
  await appendImage(page, "beam");
  await expect(body.locator("img")).toHaveCount(1);
  // 내려받을 파일 이름 확인을 위해 영문 제목 (format.spec.ts 참고: 헤드리스 Chromium은 한글 파일 이름을 바꾼다)
  await page.getByRole("textbox", { name: "문서 제목" }).fill("scenario2 report");

  // 3) 서식 템플릿 적용: 학술 논문형 프리셋을 고르고 용지를 B5로 바꿔 내 템플릿으로 저장(=이 문서에 적용)
  await page.getByRole("button", { name: "서식", exact: true }).click();
  const panel = page.getByTestId("format-panel");
  await panel.getByLabel("서식 템플릿").selectOption({ label: "학술 논문형" });
  await expect(page.getByTestId("format-notice")).toHaveText("이 문서에 서식을 적용했어요.");
  await panel.getByLabel("용지 크기").selectOption("B5");
  await panel.getByLabel("템플릿 이름").fill("학교 제출 양식");
  await panel.getByRole("button", { name: "새 템플릿으로 저장" }).click();
  await expect(page.getByTestId("format-notice")).toHaveText("서식을 저장하고 이 문서에 적용했어요.");
  // 가져온 문단에도 서식이 반영된다 (화면)
  const importedPara = page.locator(".doc-content .tiptap p", { hasText: "표 아래 문단" });
  await expect.poll(() => importedPara.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Noto Serif KR");
  await expect
    .poll(() => importedPara.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize)))
    .toBeCloseTo((10 * 96) / 72, 1);

  // 4) 그림을 선택하고 단축키로 캡션을 단다 (captions.spec.ts와 같은 경로)
  await body.locator("img").click();
  await page.keyboard.press("ControlOrMeta+Shift+C");
  await page.keyboard.type("보 끝단 형상");
  const caption = body.locator('p[data-type="caption"][data-kind="figure"]');
  await expect(caption).toHaveText("그림 1. 보 끝단 형상");

  // 5) PDF 내보내기 (format.spec.ts와 같은 경로)
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByTestId("export-panel").getByRole("button", { name: "PDF로 내보내기" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("scenario2 report.pdf");
  const pdfPath = testInfo.outputPath("scenario2.pdf");
  await file.saveAs(pdfPath);
  await expect(page.getByTestId("export-status")).toContainText("파일을 내려받았어요.");

  // 용지: B5 세로 (182 × 257 mm)
  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const [, w, h] = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info)!;
  expect(Math.abs(Number(w) - (182 * 72) / 25.4)).toBeLessThan(1);
  expect(Math.abs(Number(h) - (257 * 72) / 25.4)).toBeLessThan(1);
  // 글꼴: 학술 논문형의 Noto Serif KR이 임베드되고 기본 서식의 Noto Sans KR은 쓰이지 않는다
  const fonts = execFileSync("pdffonts", [pdfPath], { encoding: "utf8" });
  expect(fonts).toMatch(/NotoSerifKR/);
  expect(fonts).not.toMatch(/NotoSansKR/);
  // 본문: 가져온 텍스트·표와 캡션 번호
  const text = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
  expect(text).toContain("음향 블랙홀 진동 감쇠 실험 보고서");
  expect(text).toContain("감쇠율은 세 번 측정한 평균이다.");
  expect(text).toContain("음향 블랙홀 보");
  expect(text).toMatch(/그림 1\.\s*보 끝단 형상/);
});
