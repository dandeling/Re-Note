import { expect, test, type Page } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";
import { openNewDoc, savedContent } from "./report-helpers";

// P7-3: 에디터 우측 패널의 AI 도우미. E2E 서버는 AI_FAKE=1(lib/ai/fake.ts)이다.
// "다듬어" → 선택 영역이 있으면 "[다듬은 글] <선택한 글>"을 replace_selection으로 제안한다.

async function openPanel(page: Page) {
  await page.getByRole("button", { name: "AI 도우미", exact: true }).click();
  const panel = page.getByTestId("editor-chat");
  await expect(panel).toBeVisible();
  return panel;
}

async function ask(page: Page, message: string) {
  const panel = page.getByTestId("editor-chat");
  const input = panel.getByLabel("AI 도우미에게 보낼 메시지");
  await input.fill(message);
  await input.press("Enter");
  const reply = panel.locator('li[data-role="assistant"]').last();
  await expect(reply.getByTestId("chat-status")).toHaveCount(0, { timeout: 15_000 });
  return reply;
}

const docText = (content: Awaited<ReturnType<typeof savedContent>>) => JSON.stringify(content);

test("에디터에서 문단을 선택하고 \"이 문단 다듬어줘\" → 제안 → 삽입 버튼으로 반영되고, 누르기 전에는 문서가 바뀌지 않는다", async ({ page }) => {
  await login(page, uniqueEmail("editor-chat"));
  await openNewDoc(page, "AI 도우미 패널");
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await body.click();
  await page.keyboard.type("첫 번째 문단입니다.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("다듬을 문단입니다.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("마지막 문단입니다.");
  const status = page.getByTestId("save-status");
  await expect(status).toHaveAttribute("data-state", "saved", { timeout: 10_000 });

  // 에디터 화면에서는 전역 플로팅 버튼이 없고, 우측 패널에 AI 도우미가 고정된다
  await expect(page.getByRole("button", { name: "AI 도우미 열기" })).toHaveCount(0);
  await openPanel(page);

  // 두 번째 문단 선택 (세 번 클릭 = 문단 전체)
  await body.locator("p").nth(1).click({ clickCount: 3 });
  const request = page.waitForRequest("**/api/chat");
  const reply = await ask(page, "이 문단 다듬어줘");
  // 선택 영역이 컨텍스트로 간다
  expect((await request).postDataJSON().selection).toBe("다듬을 문단입니다.");

  const card = reply.getByTestId("chat-suggestion");
  await expect(card).toContainText("선택한 부분을 바꿀 글 제안");
  await expect(card).toContainText("[다듬은 글] 다듬을 문단입니다.");

  // 삽입을 누르기 전: 화면도 서버도 그대로
  await expect(body.locator("p")).toHaveText(["첫 번째 문단입니다.", "다듬을 문단입니다.", "마지막 문단입니다."]);
  await expect(status).toHaveAttribute("data-state", "saved");
  const before = await savedContent(page);
  expect(docText(before)).not.toContain("[다듬은 글]");

  await card.getByRole("button", { name: "삽입" }).click();
  await expect(card.getByRole("button", { name: "삽입됨" })).toBeDisabled();
  await expect(body.locator("p")).toHaveText(["첫 번째 문단입니다.", "[다듬은 글] 다듬을 문단입니다.", "마지막 문단입니다."]);

  // 삽입 후 자동 저장이 돈다
  await expect(status).toHaveAttribute("data-state", "saved", { timeout: 10_000 });
  await expect.poll(async () => docText(await savedContent(page))).toContain("[다듬은 글] 다듬을 문단입니다.");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "문서 본문" }).locator("p").nth(1)).toHaveText("[다듬은 글] 다듬을 문단입니다.");
});

test("수식·서식 제안: 수식은 삽입하면 문서에 들어가고, 서식은 폼에 채워져 사용자가 저장해야 적용된다", async ({ page }) => {
  await login(page, uniqueEmail("editor-chat-2"));
  await openNewDoc(page, "AI 도우미 수식 서식");
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await body.click();
  await page.keyboard.type("본문입니다.");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 10_000 });
  await openPanel(page);

  const latex = await ask(page, "근의 공식 수식 만들어줘");
  const latexCard = latex.getByTestId("chat-suggestion");
  await expect(latexCard).toContainText("수식 제안");
  await expect(body.locator('div[data-type="math-block"]')).toHaveCount(0);
  await latexCard.getByRole("button", { name: "삽입" }).click();
  const block = body.locator('div[data-type="math-block"]');
  await expect(block).toHaveCount(1);
  await expect(block).toHaveAttribute("data-latex", "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}");
  await expect(body.locator("p").first()).toHaveText("본문입니다."); // 기존 글은 그대로

  // 대화는 탭을 오가도 남는다
  await page.getByRole("button", { name: "서식", exact: true }).click();
  await page.getByRole("button", { name: "AI 도우미", exact: true }).click();
  await expect(page.getByTestId("editor-chat").locator('li[data-role="user"]')).toHaveCount(1);

  const format = await ask(page, "서식을 본문 함초롬바탕 10pt, 줄간격 160%로 맞춰줘");
  const formatCard = format.getByTestId("chat-suggestion");
  await expect(formatCard).toContainText("서식 규칙 제안");
  await formatCard.getByRole("button", { name: "삽입" }).click();
  // 서식 탭이 열리고 폼에 채워진다. 아직 저장(적용)되지 않았다.
  const formPanel = page.getByTestId("format-panel");
  await expect(formPanel.getByLabel("본문 크기 (pt)")).toHaveValue("10");
  await expect(formPanel.getByLabel("줄 간격 (%)")).toHaveValue("160");
  await expect(page.getByTestId("format-notice")).toHaveText("제안된 서식을 폼에 채웠어요. 확인한 뒤 저장하면 적용돼요.");
  await expect(page.getByTestId("format-dirty")).toBeVisible();
});
