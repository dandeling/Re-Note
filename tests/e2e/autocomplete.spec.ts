import { expect, test, type Page } from "@playwright/test";
import { createProjectAndDoc, login, uniqueEmail } from "./helpers";

/**
 * 글쓰기 자동완성 (AI_FAKE=1의 가짜 제안, lib/ai/fake.ts의 FAKE_AUTOCOMPLETE).
 * - 멈추면 흐린 제안(ghost) → Tab으로 받아들이기, Esc로 닫기, Ctrl+Space로 바로 요청
 * - 제안은 문서 내용(자동 저장)에 들어가지 않는다
 */
const FINISH = "추가 실험으로 확인할 필요가 있다.";
const NEXT = "이 결과는 추가 실험으로 확인할 필요가 있다.";
const BEFORE = "진자의 길이를 바꾸며 주기를 측정하였다. 그 결과 길이가 길어질수록";

const editorBox = (page: Page) => page.getByRole("textbox", { name: "문서 본문" });
const ghost = (page: Page) => page.getByTestId("autocomplete-ghost");

async function savedContent(page: Page) {
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 15_000 });
  const docId = new URL(page.url()).pathname.split("/").pop()!;
  const res = await page.request.get(`/api/docs/${docId}`);
  return JSON.stringify((await res.json()).document.contentJson);
}

test.beforeEach(async ({ page }) => {
  await login(page, uniqueEmail("autocomplete"));
  await createProjectAndDoc(page, "자동완성 테스트");
});

test("멈추면 흐린 제안이 뜨고, 자동 저장에는 섞이지 않으며, Esc로 닫고 Tab으로 받아들인다", async ({ page }) => {
  const toggle = page.getByTestId("autocomplete-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await editorBox(page).click();
  await page.keyboard.type(BEFORE);
  await expect(ghost(page)).toBeVisible({ timeout: 5_000 });
  await expect(ghost(page)).toContainText(FINISH);
  await expect(ghost(page)).toHaveAttribute("aria-hidden", "true");
  // 첫 제안에만 힌트
  await expect(page.getByTestId("autocomplete-hint")).toBeVisible();
  await expect(page.getByTestId("autocomplete-live")).toHaveText(/자동완성 제안이 있습니다/);

  // 제안이 떠 있는 동안 저장된 문서에는 제안이 없다
  const saved = await savedContent(page);
  expect(saved).toContain("길어질수록");
  expect(saved).not.toContain(FINISH);
  await expect(ghost(page)).toBeVisible();

  // Esc: 제안만 닫고 에디터 포커스는 그대로
  await page.keyboard.press("Escape");
  await expect(ghost(page)).toHaveCount(0);
  await expect(editorBox(page)).toBeFocused();
  await expect(page.getByTestId("autocomplete-live")).toHaveText("");

  // Ctrl+Space: 바로 요청 → Tab: 받아들이기
  await page.keyboard.press("Control+Space");
  await expect(ghost(page)).toBeVisible({ timeout: 3_000 });
  await expect(page.getByTestId("autocomplete-hint")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(ghost(page)).toHaveCount(0);
  await expect(editorBox(page)).toContainText(`${BEFORE} ${FINISH}`);
  await expect(editorBox(page)).toBeFocused();
  expect(await savedContent(page)).toContain(`${BEFORE} ${FINISH}`);

  // 계속 입력하면 제안이 사라진다
  await page.keyboard.press("Control+Space");
  await expect(ghost(page)).toContainText(NEXT, { timeout: 3_000 });
  await page.keyboard.type(" 그리고");
  await expect(ghost(page)).toHaveCount(0);
});

test("한글 IME 조합 중에는 제안하지 않고, 조합이 끝난 뒤에도 글이 깨지지 않는다", async ({ page }) => {
  await editorBox(page).click();
  await page.keyboard.type("측정값을 표로 정리하면 다음과 같은 경향이 ");
  await expect(ghost(page)).toBeVisible({ timeout: 5_000 });

  const cdp = await page.context().newCDPSession(page);
  // "보인다"를 조합으로 입력 (조합 중에는 1.2초 넘게 멈춰도 제안이 뜨지 않아야 한다)
  for (const step of ["ㅂ", "보", "봉"]) {
    await cdp.send("Input.imeSetComposition", { text: step, selectionStart: step.length, selectionEnd: step.length });
  }
  await expect(ghost(page)).toHaveCount(0);
  await page.waitForTimeout(1_800);
  await expect(ghost(page)).toHaveCount(0);
  await cdp.send("Input.insertText", { text: "보" });
  for (const step of ["ㅇ", "이", "인"]) {
    await cdp.send("Input.imeSetComposition", { text: step, selectionStart: step.length, selectionEnd: step.length });
  }
  await cdp.send("Input.insertText", { text: "인" });
  await cdp.send("Input.insertText", { text: "다." });

  await expect(editorBox(page)).toContainText("다음과 같은 경향이 보인다.");
  await expect(ghost(page)).toContainText(NEXT, { timeout: 5_000 });
  await page.keyboard.press("Tab");
  await expect(editorBox(page)).toContainText(`경향이 보인다. ${NEXT}`);
  const saved = await savedContent(page);
  expect(saved).toContain(`경향이 보인다. ${NEXT}`);
});

test("토글을 끄면 제안하지 않고, 새로고침해도 꺼진 상태를 기억한다. 표 안에서는 동작하지 않는다", async ({ page }) => {
  const toggle = page.getByTestId("autocomplete-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await editorBox(page).click();
  await page.keyboard.type(BEFORE);
  await page.waitForTimeout(2_000);
  await expect(ghost(page)).toHaveCount(0);
  await page.keyboard.press("Control+Space");
  await page.waitForTimeout(800);
  await expect(ghost(page)).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("autocomplete-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("autocomplete-toggle").click();
  await expect(page.getByTestId("autocomplete-toggle")).toHaveAttribute("aria-pressed", "true");

  // 표 안에서는 켜져 있어도 제안하지 않는다
  await editorBox(page).click();
  await page.keyboard.press("Control+Home");
  await page.getByRole("button", { name: "표 삽입" }).click();
  await page.keyboard.type("표 안에 길게 쓰는 내용입니다 열 글자 이상");
  await page.waitForTimeout(1_800);
  await page.keyboard.press("Control+Space");
  await page.waitForTimeout(800);
  await expect(ghost(page)).toHaveCount(0);
});
