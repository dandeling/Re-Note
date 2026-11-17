import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { createProjectAndDoc, login, uniqueEmail } from "./helpers";

const PT = 96 / 72;
const style = (page: Page, selector: string, prop: string) =>
  page.locator(`.doc-content .tiptap ${selector}`).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const px = async (page: Page, selector: string, prop: string) => Number.parseFloat(await style(page, selector, prop));

// 개발 서버가 문서 화면을 처음 컴파일하는 시간 때문에 첫 테스트가 시간 초과되지 않도록 미리 한 번 연다.
test.beforeAll(async ({ request }) => {
  await request.get("/projects/warmup/docs/warmup", { timeout: 60_000 });
});

async function writeDoc(page: Page) {
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await body.click();
  await page.getByRole("button", { name: "제목 1" }).click();
  await page.keyboard.type("탐구 제목");
  await page.keyboard.press("Enter");
  await page.keyboard.type("첫 번째 문단입니다.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("두 번째 문단입니다.");
}

test("서식 규칙을 바꾸면 문서 전체에 즉시 반영되고, 저장하면 다시 열어도 유지된다 (SPEC 7.3 (d))", async ({ page }) => {
  await login(page, uniqueEmail("format"));
  await createProjectAndDoc(page);
  await writeDoc(page);

  // 기본: 일반 보고서 (Noto Sans KR 11pt, 줄 간격 160%)
  await expect.poll(() => px(page, "p", "font-size")).toBeCloseTo(11 * PT, 1);
  expect(await style(page, "p", "font-family")).toContain("Noto Sans KR");

  await page.getByRole("button", { name: "서식", exact: true }).click();
  const panel = page.getByTestId("format-panel");
  await expect(panel.getByLabel("서식 템플릿")).toHaveValue("preset-general");

  // 프리셋 적용 → 모든 문단과 제목에 반영
  await panel.getByLabel("서식 템플릿").selectOption({ label: "학술 논문형" });
  await expect(page.getByTestId("format-notice")).toHaveText("이 문서에 서식을 적용했어요.");
  await expect.poll(() => style(page, "p", "font-family")).toContain("Noto Serif KR");
  for (const p of await page.locator(".doc-content .tiptap p").all()) {
    expect(Number.parseFloat(await p.evaluate((el) => getComputedStyle(el).fontSize))).toBeCloseTo(10 * PT, 1);
    expect(Number.parseFloat(await p.evaluate((el) => getComputedStyle(el).textIndent))).toBeCloseTo(10 * PT, 1);
  }
  expect(await style(page, "h1", "text-align")).toBe("center");
  expect(await px(page, "h1", "font-size")).toBeCloseTo(16 * PT, 1);

  // 폼 값 변경 → 저장 전에도 즉시 반영
  await panel.getByLabel("본문 크기 (pt)").fill("14");
  await expect.poll(() => px(page, "p", "font-size")).toBeCloseTo(14 * PT, 1);
  await panel.getByLabel("줄 간격 (%)").fill("200");
  await expect.poll(() => px(page, "p", "line-height")).toBeCloseTo(14 * PT * 2, 0);
  await panel.getByLabel("본문 글꼴").selectOption("nanum-gothic");
  await expect.poll(() => style(page, "p", "font-family")).toContain("Nanum Gothic");
  await panel.getByLabel("제목 1 정렬").selectOption("right");
  await expect.poll(() => style(page, "h1", "text-align")).toBe("right");
  await panel.getByLabel("위 여백 (mm)").fill("40");
  await expect.poll(() => px(page, "", "padding-top")).toBeCloseTo((40 * 96) / 25.4, 0);
  await expect(page.getByTestId("format-dirty")).toBeVisible();

  // 실제로 웹 글꼴이 로드되어 쓰인다 (대체 글꼴로 떨어지지 않는다)
  await expect.poll(() => page.evaluate(() => document.fonts.check('14pt "Nanum Gothic"', "가"))).toBe(true);

  // 내 템플릿으로 저장 → 새로고침해도 유지
  await panel.getByLabel("템플릿 이름").fill("우리 학교 양식");
  await panel.getByRole("button", { name: "새 템플릿으로 저장" }).click();
  await expect(page.getByTestId("format-notice")).toHaveText("서식을 저장하고 이 문서에 적용했어요.");
  await expect(page.getByTestId("format-dirty")).toHaveCount(0);

  await page.reload();
  await expect.poll(() => px(page, "p", "font-size")).toBeCloseTo(14 * PT, 1);
  expect(await style(page, "p", "font-family")).toContain("Nanum Gothic");
  await page.getByRole("button", { name: "서식", exact: true }).click();
  await expect(page.getByTestId("format-panel").getByLabel("서식 템플릿").locator("option:checked")).toHaveText("우리 학교 양식");
});

test("rulesJson을 폼에 채우면 임베드할 수 없는 글꼴은 대체하고 알린다", async ({ page }) => {
  await login(page, uniqueEmail("format-fill"));
  await createProjectAndDoc(page);
  await writeDoc(page);
  await expect.poll(() => px(page, "p", "font-size")).toBeCloseTo(11 * PT, 1);

  // AI 변환 결과(일부만 채운 규칙)가 들어온 상황: lib/format/fill.ts의 requestFormatFill과 같은 이벤트
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("researchmate:format-fill", {
        detail: { body: { font: "함초롬바탕", sizePt: 10, lineHeight: 160 }, headings: { h1: { sizePt: 16, bold: true, align: "center" } } },
      }),
    ),
  );
  const panel = page.getByTestId("format-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("본문 글꼴")).toHaveValue("noto-serif-kr");
  await expect(panel.getByLabel("본문 크기 (pt)")).toHaveValue("10");
  await expect(panel.getByLabel("제목 1 정렬")).toHaveValue("center");
  await expect(page.getByTestId("format-font-notice")).toContainText("‘함초롬바탕’ 글꼴은 웹에서 쓸 수 없어");
  await expect(page.getByTestId("format-font-notice")).toContainText("Noto Serif KR");
  await expect.poll(() => style(page, "p", "font-family")).toContain("Noto Serif KR");
  await expect.poll(() => style(page, "h1", "text-align")).toBe("center");
});

test("서식 검사: 규칙에서 벗어난 부분을 목록으로 보여 주고 모두 고치기로 고친다 (P2-6)", async ({ page }) => {
  await login(page, uniqueEmail("format-check"));
  await createProjectAndDoc(page);
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await body.click();
  await page.getByRole("button", { name: "제목 1" }).click();
  await page.keyboard.type("탐구 제목");
  await page.getByRole("button", { name: "가운데 정렬" }).click(); // 규칙(일반 보고서: 왼쪽)과 다름
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "왼쪽 정렬" }).click(); // 이어지는 줄은 정렬을 물려받으므로 되돌린다
  await page.getByRole("button", { name: "제목 3" }).click(); // 제목 1 다음에 제목 3
  await page.keyboard.type("세부 내용");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "표 삽입" }).click(); // 캡션 없는 표

  await page.getByRole("button", { name: "서식 검사", exact: true }).click();
  const panel = page.getByTestId("format-check");
  const list = panel.getByTestId("format-check-list");
  await expect(list.locator("li[data-code='heading-align']")).toContainText("제목 정렬이 서식 규칙(왼쪽)과 달라요: “탐구 제목”");
  await expect(list.locator("li[data-code='heading-skip']")).toContainText("제목 1 다음에 제목 3");
  // 캡션 노드가 있으므로 캡션 누락도 "모두 고치기"로 고칠 수 있다 (직접 고쳐야 한다는 표시가 없다).
  await expect(list.locator("li[data-code='caption-missing']")).toContainText("표에 캡션이 없어요.");
  await expect(list.locator("li[data-code='caption-missing']")).not.toContainText("직접 고쳐야 해요");
  await expect(panel.getByTestId("format-check-summary")).toHaveText("규칙에서 벗어난 부분 3곳");

  await panel.getByRole("button", { name: "모두 고치기" }).click();
  await expect(panel.getByTestId("format-check-fixed")).toHaveText("3곳을 고쳤어요.");
  await expect(panel.getByTestId("format-check-summary")).toHaveText("서식 규칙에서 벗어난 부분이 없어요.");
  await expect(page.locator('.doc-content .tiptap p[data-type="caption"][data-kind="table"]')).toHaveText(/^표 1\./);
  await expect(page.locator(".doc-content .tiptap h2")).toHaveText("세부 내용");
  await expect(page.locator(".doc-content .tiptap h3")).toHaveCount(0);
  expect(await style(page, "h1", "text-align")).toBe("left");

  // 고친 결과는 저장된다
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 10_000 });
  await page.reload();
  await expect(page.locator(".doc-content .tiptap h2")).toHaveText("세부 내용");
  await expect(page.locator('.doc-content .tiptap p[data-type="caption"][data-kind="table"]')).toHaveCount(1);
});

test("서식 규칙을 바꾸면 화면과 PDF 내보내기 결과에 똑같이 적용된다 (P2-8, SPEC 7.3 완료 기준)", async ({ page }, testInfo) => {
  await login(page, uniqueEmail("format-pdf"));
  await createProjectAndDoc(page);
  // 테스트용 헤드리스 Chromium은 ASCII가 아닌 파일 이름을 "download"로 바꾸므로 영문 제목을 쓴다.
  // (한글 파일 이름의 Content-Disposition은 단위 테스트에서 확인한다.)
  await page.getByRole("textbox", { name: "문서 제목" }).fill("format report");
  await writeDoc(page);

  await page.getByRole("button", { name: "서식", exact: true }).click();
  const panel = page.getByTestId("format-panel");
  await panel.getByLabel("용지 크기").selectOption("B5");
  await panel.getByLabel("방향").selectOption("landscape");
  await panel.getByLabel("본문 글꼴").selectOption("nanum-myeongjo");
  await panel.getByLabel("본문 크기 (pt)").fill("13");
  await panel.getByLabel("쪽 번호 모양").selectOption("dash");

  // 화면: 저장 전에도 즉시 반영
  await expect.poll(() => style(page, "p", "font-family")).toContain("Nanum Myeongjo");
  await expect.poll(() => px(page, "p", "font-size")).toBeCloseTo(13 * PT, 1);
  await expect.poll(() => px(page, "", "max-width")).toBeCloseTo((257 * 96) / 25.4, 0); // B5 가로 폭의 종이

  // 내보내기: 저장하지 않은 서식과 본문을 저장한 뒤 같은 규칙으로 PDF를 만든다
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-panel").getByRole("button", { name: "PDF로 내보내기" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("format report.pdf");
  const pdfPath = testInfo.outputPath("out.pdf");
  await file.saveAs(pdfPath);
  await expect(page.getByTestId("export-status")).toContainText("파일을 내려받았어요.");
  await expect(page.getByTestId("format-dirty")).toHaveCount(0);

  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const [, w, h] = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info)!;
  expect(Math.abs(Number(w) - (257 * 72) / 25.4)).toBeLessThan(1);
  expect(Math.abs(Number(h) - (182 * 72) / 25.4)).toBeLessThan(1);
  const fonts = execFileSync("pdffonts", [pdfPath], { encoding: "utf8" });
  expect(fonts).toMatch(/NanumMyeongjo/);
  const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
  expect(text).toContain("두 번째 문단입니다.");
  expect(text).toMatch(/^\s*-\s?1\s?-\s*$/m);

  // Markdown·DOCX도 내려받을 수 있다
  for (const [label, ext] of [["Markdown으로 내보내기", "md"], ["Word(DOCX)로 내보내기", "docx"]] as const) {
    const next = page.waitForEvent("download");
    await page.getByTestId("export-panel").getByRole("button", { name: label }).click();
    expect((await next).suggestedFilename()).toBe(`format report.${ext}`);
  }
});
