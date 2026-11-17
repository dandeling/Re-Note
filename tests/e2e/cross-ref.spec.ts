import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";
import { image, openNewDoc, paragraph, savedContent, seedDocument, waitSaved } from "./report-helpers";

test("[7.3] 그림 3개 중 2번째를 삭제하면 캡션과 본문 참조 번호가 자동으로 바뀐다", async ({ page }) => {
  await login(page, uniqueEmail("xref"));
  await openNewDoc(page);
  await seedDocument(page, [image("A"), image("B"), image("C"), paragraph()]);
  const body = page.getByRole("textbox", { name: "문서 본문" });
  const captions = body.locator('p[data-type="caption"]');
  const refs = body.locator('span[data-type="cross-ref"]');
  const picker = page.getByTestId("cross-ref-picker");

  // 그림 3개에 캡션
  for (const [i, text] of ["장치", "과정", "결과"].entries()) {
    await body.locator("img").nth(i).click();
    await page.keyboard.press("ControlOrMeta+Shift+C");
    await page.keyboard.type(text);
  }
  await expect(captions).toHaveText(["그림 1. 장치", "그림 2. 과정", "그림 3. 결과"]);

  // 본문에서 @그림 → 목록에서 키보드로 골라 참조 3개 삽입
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("먼저 @그림");
  await expect(picker.getByRole("option")).toHaveText([/그림 1\..*장치/, /그림 2\..*과정/, /그림 3\..*결과/]);
  await expect(picker.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);
  await page.keyboard.type(" 다음 @그림");
  await page.keyboard.press("ArrowDown");
  await expect(picker.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await page.keyboard.type(" 끝으로 @그림3");
  await expect(picker.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.type(" 참고.");
  await expect(refs).toHaveText(["그림 1", "그림 2", "그림 3"]);
  await expect(body.locator("p").last()).toHaveText("먼저 그림 1 다음 그림 2 끝으로 그림 3 참고.");

  // 2번째 그림 삭제 → 캡션이 함께 사라지고, 3번째가 그림 2가 되며 참조도 따라간다.
  await body.locator("img").nth(1).click();
  await page.keyboard.press("Delete");
  await expect(body.locator("img")).toHaveCount(2);
  await expect(captions).toHaveText(["그림 1. 장치", "그림 2. 결과"]);
  await expect(refs).toHaveText(["그림 1", "참조 오류", "그림 2"]);
  await expect(refs.nth(1)).toHaveAttribute("data-broken", "true");
  await expect(refs.nth(2)).toHaveAttribute("data-broken", "false");

  // 저장된 문서에는 번호가 아니라 대상 id만 있다. 다시 열어도 같은 번호.
  await waitSaved(page);
  const saved = JSON.stringify(await savedContent(page));
  expect(saved).toContain('"type":"crossRef"');
  expect(saved).not.toMatch(/그림 \d/);
  await page.reload();
  await expect(refs).toHaveText(["그림 1", "참조 오류", "그림 2"]);

  // 실행 취소는 새로 연 문서에서는 못 하므로, 맨 앞 그림을 지워 번호가 한 번 더 당겨지는지 본다.
  // (문서를 열면 맨 앞 그림이 이미 선택돼 있어, 다른 곳을 눌렀다가 다시 고른다.)
  await body.locator("p").last().click();
  await body.locator("img").first().click();
  await page.keyboard.press("Backspace");
  await expect(captions).toHaveText(["그림 1. 결과"]);
  await expect(refs).toHaveText(["참조 오류", "참조 오류", "그림 1"]);
});

test("@ 참조 목록: 표·수식 고르기, Esc로 닫기, 대상이 없을 때 안내, 툴바 버튼", async ({ page }) => {
  await login(page, uniqueEmail("xref2"));
  await openNewDoc(page);
  const body = page.getByRole("textbox", { name: "문서 본문" });
  const picker = page.getByTestId("cross-ref-picker");
  const refs = body.locator('span[data-type="cross-ref"]');

  // 아직 대상이 없으면 안내만 보이고 Enter는 평소처럼 줄을 바꾼다.
  await body.click();
  await page.keyboard.type("@그림");
  await expect(picker).toContainText("참조할 대상이 없어요");
  await page.keyboard.press("Enter");
  await expect(refs).toHaveCount(0);
  // 사람 이름 같은 입력에는 목록이 뜨지 않는다.
  await page.keyboard.type("@홍길동");
  await expect(picker).toHaveCount(0);
  await page.keyboard.press("Enter");

  // 표 + 캡션
  await page.getByRole("button", { name: "표 삽입" }).click();
  await page.keyboard.press("ControlOrMeta+Shift+C");
  await page.keyboard.type("측정 조건");
  await page.keyboard.press("ControlOrMeta+End");

  // Esc로 닫으면 글자는 그대로 남고, 계속 입력해도 다시 뜨지 않는다.
  await page.keyboard.type("@표");
  await expect(picker.getByRole("option")).toHaveText([/표 1\..*측정 조건/]);
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await page.keyboard.type("1");
  await expect(picker).toHaveCount(0);
  await page.keyboard.type(" ");

  // 툴바 버튼으로 열어 마우스로 고른다.
  await page.getByRole("button", { name: /상호 참조 넣기/ }).click();
  await expect(picker.getByRole("option")).toHaveCount(1);
  await picker.getByRole("option").first().click();
  await expect(refs).toHaveText(["표 1"]);
  await expect(body.locator("p").last()).toHaveText("@표1 표 1");
});
