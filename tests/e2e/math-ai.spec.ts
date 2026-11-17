import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";
import { openNewDoc, savedContent, waitSaved } from "./report-helpers";

// P7-5 (SPEC 7.3 (c)): `$$` 입력과 자연어 입력(그리고 수식 이미지) 모두로 수식을 넣을 수 있다.
// E2E 서버는 AI_FAKE=1: "근의 공식" → 근의 공식 LaTeX(block), 이미지 → "E = mc^2"(block).

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const QUADRATIC = "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}";

test("`$$` 입력과 자연어·이미지 입력 모두로 수식을 넣을 수 있다", async ({ page }) => {
  await login(page, uniqueEmail("math-ai"));
  await openNewDoc(page, "수식 자동화");
  const body = page.getByRole("textbox", { name: "문서 본문" });
  const blocks = body.locator('div[data-type="math-block"]');

  // 1) $$ 입력
  await body.click();
  await page.keyboard.type("$$E=mc^2$$");
  await expect(blocks).toHaveCount(1);
  await page.keyboard.type("설명 문단");

  // 2) 자연어 → LaTeX → 미리보기 → 삽입
  await page.getByRole("button", { name: "자연어·이미지로 수식 만들기" }).click();
  const panel = page.getByTestId("math-ai-panel");
  await panel.getByLabel("만들 수식 설명").fill("x에 대한 2차 방정식 근의 공식");
  await panel.getByRole("button", { name: "LaTeX 만들기" }).click();
  await expect(panel.getByLabel("제안된 LaTeX")).toHaveValue(QUADRATIC);
  await expect(panel.getByTestId("math-ai-preview").locator(".katex-display .mfrac")).toBeVisible();
  await expect(panel.getByRole("radio", { name: "블록 수식" })).toBeChecked();
  await expect(blocks).toHaveCount(1); // 삽입 전에는 문서가 그대로
  await panel.getByRole("button", { name: "수식 삽입" }).click();
  await expect(panel).toHaveCount(0);
  await expect(blocks).toHaveCount(2);
  await expect(blocks.nth(1)).toHaveAttribute("data-latex", QUADRATIC);
  await expect(blocks.locator(".doc-math-tag")).toHaveText(["(1)", "(2)"]);

  // 3) 이미지 선택 → LaTeX
  await page.getByRole("button", { name: "자연어·이미지로 수식 만들기" }).click();
  await panel.getByLabel("수식 캡처 이미지").setInputFiles({ name: "eq.png", mimeType: "image/png", buffer: PNG });
  await expect(panel.getByLabel("제안된 LaTeX")).toHaveValue("E = mc^2");
  // 사용자가 고친 뒤 문장 안 수식으로 넣는다
  await panel.getByLabel("제안된 LaTeX").fill("E = mc^3");
  await panel.getByRole("radio", { name: "문장 안 수식" }).check();
  await panel.getByRole("button", { name: "수식 삽입" }).click();
  await expect(body.locator('span[data-type="math-inline"]')).toHaveAttribute("data-latex", "E = mc^3");

  // 4) 이미지 붙여넣기 → LaTeX
  await page.getByRole("button", { name: "자연어·이미지로 수식 만들기" }).click();
  await panel.getByLabel("만들 수식 설명").focus();
  await page.evaluate((bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], "paste.png", { type: "image/png" }));
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [...PNG]);
  await expect(panel.getByLabel("제안된 LaTeX")).toHaveValue("E = mc^2");
  await panel.getByRole("button", { name: "수식 삽입" }).click();
  await expect(blocks).toHaveCount(3);

  await waitSaved(page);
  const saved = JSON.stringify(await savedContent(page));
  expect(saved).toContain("E=mc^2");
  expect(saved).toContain(JSON.stringify(QUADRATIC).slice(1, -1));
  expect(saved).toContain("E = mc^3");
});
