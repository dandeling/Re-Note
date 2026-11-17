import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";
import { openNewDoc, savedContent, waitSaved } from "./report-helpers";

test("쉬운 수식 입력: 평범한 표기 → LaTeX로 저장, 미리보기·틀 버튼·오류 안내, 기존 수식은 LaTeX 직접 모드", async ({ page }) => {
  await login(page, uniqueEmail("math-easy"));
  await openNewDoc(page);
  const body = page.getByRole("textbox", { name: "문서 본문" });
  const blocks = body.locator('div[data-type="math-block"]');
  const inline = body.locator('span[data-type="math-inline"]');
  const panel = page.getByTestId("math-panel");
  const easy = page.getByRole("textbox", { name: "수식 (쉬운 입력)" });
  const latex = page.getByRole("textbox", { name: "LaTeX" });
  const preview = panel.getByTestId("math-preview");

  // 툴바 → 블록 수식: 쉬운 입력으로 열리고, 치는 대로 미리보기와 본문이 KaTeX로 그려진다.
  await body.click();
  await page.keyboard.type("첫 문단");
  await page.getByRole("button", { name: /블록 수식 넣기/ }).click();
  await expect(easy).toBeFocused();
  await expect(panel.getByRole("radio", { name: "쉬운 입력" })).toBeChecked();
  await page.keyboard.type("x^2 + sqrt(y)/2");
  await expect(preview.locator(".katex .mfrac")).toBeVisible();
  await expect(preview.locator(".katex .sqrt")).toBeVisible();
  await expect(panel.getByTestId("math-converted")).toHaveText("x^2 + \\frac{\\sqrt{y}}{2}");
  await expect(blocks.first().locator(".katex-display .mfrac")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(panel).toHaveCount(0);
  await expect(blocks.first()).toHaveAttribute("data-latex", "x^2 + \\frac{\\sqrt{y}}{2}");

  // 틀 버튼(분수): 첫 칸이 골라져 있어 바로 칠 수 있다. 화살표로 다음 버튼.
  await page.keyboard.type("둘째 문단 ");
  await page.getByRole("button", { name: /인라인 수식 넣기/ }).click();
  await expect(easy).toBeFocused();
  await panel.getByRole("button", { name: "분수", exact: true }).click();
  await expect(easy).toBeFocused();
  await page.keyboard.type("a");
  await expect(easy).toHaveValue("(a)/( )");
  await easy.fill("(a+1)/b");
  await expect(panel.getByTestId("math-converted")).toHaveText("\\frac{a+1}{b}");

  // 이해 못하는 표기는 한국어로 알려 준다.
  await easy.fill("\\frac{a");
  await expect(panel.getByRole("alert")).toContainText("이해하지 못했어요");
  await easy.fill("(a+1)/b");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await easy.press("Enter");
  await expect(inline).toHaveCount(1);
  await expect(inline.first()).toHaveAttribute("data-latex", "\\frac{a+1}{b}");

  // Esc: 새로 넣던 수식은 넣지 않는다.
  await page.getByRole("button", { name: /인라인 수식 넣기/ }).click();
  await expect(easy).toBeFocused();
  await page.keyboard.type("pi");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(inline).toHaveCount(1);

  // 이미 있는 수식은 LaTeX 직접 모드로 열린다. 쉬운 입력으로 바꿔도 같은 수식이다.
  await blocks.first().click();
  await page.keyboard.press("Enter");
  await expect(latex).toBeFocused();
  await expect(latex).toHaveValue("x^2 + \\frac{\\sqrt{y}}{2}");
  await expect(panel.getByRole("radio", { name: "LaTeX 직접" })).toBeChecked();
  await panel.getByText("쉬운 입력", { exact: true }).click();
  await expect(easy).toHaveValue("x^2 + sqrt(y)/2");
  await easy.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(blocks.first()).toHaveAttribute("data-latex", "x^2 + \\frac{\\sqrt{y}}{2}");

  // 저장 값은 LaTeX이고, 새로 고침 뒤에도 KaTeX로 그려진다.
  await waitSaved(page);
  const saved = JSON.stringify(await savedContent(page));
  expect(saved).toContain('"latex":"x^2 + \\\\frac{\\\\sqrt{y}}{2}"');
  expect(saved).toContain('"latex":"\\\\frac{a+1}{b}"');
  await page.reload();
  await expect(blocks.first().locator(".katex-display .mfrac")).toBeVisible({ timeout: 30_000 });
  await expect(blocks.first()).toHaveAttribute("data-latex", "x^2 + \\frac{\\sqrt{y}}{2}");
  await expect(inline.first().locator(".katex")).toBeVisible();
});
