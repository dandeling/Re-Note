import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";
import { openNewDoc, savedContent, waitSaved } from "./report-helpers";

test("$...$ / $$...$$ 입력 즉시 KaTeX로 그려지고, 블록 수식은 번호와 상호 참조를 받는다", async ({ page }) => {
  await login(page, uniqueEmail("math"));
  await openNewDoc(page);
  const body = page.getByRole("textbox", { name: "문서 본문" });
  const inline = body.locator('span[data-type="math-inline"]');
  const blocks = body.locator('div[data-type="math-block"]');
  const panel = page.getByTestId("math-panel");
  const input = page.getByRole("textbox", { name: "LaTeX" });

  // 인라인: 닫는 $를 치는 순간 수식이 된다.
  await body.click();
  await page.keyboard.type("넓이는 $x^2$");
  await expect(inline).toHaveCount(1);
  await expect(inline.locator(".katex")).toBeVisible();
  await expect(inline).toHaveAttribute("data-latex", "x^2");
  await page.keyboard.type(" 이다.");
  await expect(body.locator("p").first()).toContainText("이다.");

  // 금액 표기는 수식으로 바꾸지 않는다.
  await page.keyboard.press("Enter");
  await page.keyboard.type("가격은 $5와 $10");
  await expect(inline).toHaveCount(1);

  // 블록: 문단 전체가 $$...$$면 번호가 붙은 블록 수식이 되고 다음 줄로 넘어간다.
  await page.keyboard.press("Enter");
  await page.keyboard.type("$$E=mc^2$$");
  await expect(blocks).toHaveCount(1);
  await expect(blocks.first().locator(".katex-display")).toBeVisible();
  await expect(blocks.first().locator(".doc-math-tag")).toHaveText("(1)");
  await page.keyboard.type("중간 문단");
  await expect(body.locator("p", { hasText: "중간 문단" })).toHaveCount(1);

  // $$ + 공백 → 빈 블록 수식이 생기고 LaTeX 입력란으로 바로 간다. 팔레트로 분수를 넣는다.
  await page.keyboard.press("Enter");
  await page.keyboard.type("$$ ");
  await expect(panel).toBeVisible();
  await expect(input).toBeFocused();
  await panel.getByRole("button", { name: "분수", exact: true }).click();
  await expect(input).toBeFocused();
  await page.keyboard.type("a");
  await expect(input).toHaveValue("\\frac{a}{}");
  // 커서는 분자 칸 안에 있다. 두 칸 오른쪽(}{ 다음)이 분모 칸.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("b");
  await expect(blocks.nth(1).locator(".mfrac")).toBeVisible(); // 입력하는 대로 본문이 다시 그려진다
  await page.keyboard.press("Enter");
  await expect(panel).toHaveCount(0);
  await expect(blocks.nth(1)).toHaveAttribute("data-latex", "\\frac{a}{b}");
  await expect(blocks.locator(".doc-math-tag")).toHaveText(["(1)", "(2)"]);

  // 잘못된 LaTeX는 입력란에서 알려 주고, Esc로 닫으면 본문으로 돌아온다 (키보드만으로 편집).
  await blocks.first().click();
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("E=mc^2");
  await page.keyboard.type("\\frac{");
  await expect(panel.getByRole("alert")).toHaveText("LaTeX 문법을 확인해 주세요");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // 툴바 버튼: 인라인 수식을 넣고 LaTeX를 입력한다.
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("상수 ");
  await page.getByRole("button", { name: /인라인 수식 넣기/ }).click();
  await expect(input).toBeFocused();
  await page.keyboard.type("\\alpha");
  await page.keyboard.press("Enter");
  await expect(inline).toHaveCount(2);
  await expect(inline.nth(1)).toHaveAttribute("data-latex", "\\alpha");

  // 상호 참조: @식 → 두 번째 수식을 고른다.
  await page.keyboard.type(" 그리고 @식");
  const picker = page.getByTestId("cross-ref-picker");
  await expect(picker.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const refs = body.locator('span[data-type="cross-ref"]');
  await expect(refs).toHaveText(["식 (2)"]);

  // 첫 수식을 지우면 번호와 참조가 당겨진다.
  await blocks.first().click();
  await page.keyboard.press("Delete");
  await expect(blocks).toHaveCount(1);
  await expect(blocks.locator(".doc-math-tag")).toHaveText(["(1)"]);
  await expect(refs).toHaveText(["식 (1)"]);

  // 저장되는 것은 LaTeX 원문뿐(렌더링 결과·번호 없음). 다시 열어도 그대로 그려진다.
  await waitSaved(page);
  const saved = JSON.stringify(await savedContent(page));
  expect(saved).toContain('"type":"mathInline","attrs":{"latex":"x^2"}');
  expect(saved).toContain('"latex":"\\\\frac{a}{b}"');
  expect(saved).not.toContain("katex");
  expect(saved).not.toContain("(1)");
  await page.reload();
  await expect(inline.first().locator(".katex")).toBeVisible();
  await expect(blocks.locator(".doc-math-tag")).toHaveText(["(1)"]);
  await expect(refs).toHaveText(["식 (1)"]);
});
