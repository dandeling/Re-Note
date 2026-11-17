import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";
import { openNewDoc } from "./report-helpers";

// E2E 서버는 AI_FAKE=1(lib/ai/fake.ts)이라 서식 변환은 SPEC 7.3 (d) 예시에 대한 결정적 규칙을 낸다.

test("서식 자유 텍스트 → AI가 폼에 채우고, 사용자가 저장해야 문서에 적용된다 (SPEC 7.3 (d))", async ({ page }) => {
  await login(page, uniqueEmail("ai-format"));
  await openNewDoc(page, "서식 자유 텍스트");
  await page.getByRole("textbox", { name: "문서 본문" }).click();
  await page.keyboard.type("본문 문단입니다.");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 10_000 });
  const docUrl = new URL(page.url()).pathname;
  const docId = docUrl.split("/").pop()!;
  const templateOf = async () =>
    (await (await page.request.get(`/api/format-templates?docId=${docId}`)).json()).documentTemplateId ?? null;
  const before = await templateOf();

  await page.getByRole("button", { name: "서식", exact: true }).click();
  const free = page.getByTestId("format-free-text");
  await free.getByLabel("자유 텍스트로 서식 입력").fill("본문 함초롬바탕 10pt, 줄간격 160%, 제목은 가운데 정렬 16pt 굵게");
  await free.getByRole("button", { name: "폼에 채우기" }).click();

  const panel = page.getByTestId("format-panel");
  await expect(page.getByTestId("format-notice")).toHaveText("제안된 서식을 폼에 채웠어요. 확인한 뒤 저장하면 적용돼요.");
  await expect(panel.getByLabel("본문 글꼴")).toHaveValue("noto-serif-kr");
  await expect(panel.getByLabel("본문 크기 (pt)")).toHaveValue("10");
  await expect(panel.getByLabel("줄 간격 (%)")).toHaveValue("160");
  await expect(panel.getByLabel("제목 1 정렬")).toHaveValue("center");
  await expect(panel.getByLabel("제목 1 크기 (pt)")).toHaveValue("16");
  await expect(page.getByTestId("format-font-notice")).toContainText("‘함초롬바탕’ 글꼴은 웹에서 쓸 수 없어");
  await expect(page.getByTestId("format-dirty")).toBeVisible();

  // 확인 전에는 문서의 서식 템플릿이 바뀌지 않는다
  expect(await templateOf()).toBe(before);

  await panel.getByRole("button", { name: "새 템플릿으로 저장" }).click();
  await expect(page.getByTestId("format-notice")).toHaveText("서식을 저장하고 이 문서에 적용했어요.");
  await expect.poll(templateOf).not.toBe(before);
});
