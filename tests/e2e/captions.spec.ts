import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";
import { image, openNewDoc, paragraph, savedContent, seedDocument, waitSaved } from "./report-helpers";

test("그림·표를 선택해 단축키나 버튼으로 캡션을 넣으면 번호가 자동으로 붙고 다시 매겨진다", async ({ page }) => {
  await login(page, uniqueEmail("caption"));
  await openNewDoc(page);
  await seedDocument(page, [image("A"), image("B"), paragraph("본문")]);
  const body = page.getByRole("textbox", { name: "문서 본문" });
  const captions = body.locator('p[data-type="caption"]');
  const captionButton = page.getByRole("button", { name: /캡션 넣기/ });

  // 대상을 고르지 않으면 버튼을 쓸 수 없다.
  await body.getByText("본문").click();
  await expect(captionButton).toBeDisabled();

  // 두 번째 그림에 단축키로 캡션 → 그림 아래에 "그림 1."
  await body.locator("img").nth(1).click();
  await page.keyboard.press("ControlOrMeta+Shift+C");
  await page.keyboard.type("둘째 그림");
  await expect(captions).toHaveCount(1);
  await expect(captions.first()).toHaveText("그림 1. 둘째 그림");
  await expect(body.locator("img").nth(1).locator("xpath=following-sibling::*[1]")).toHaveAttribute("data-type", "caption");

  // 첫 번째 그림에 버튼으로 캡션 → 앞에 끼어들었으므로 뒤 캡션이 그림 2로 밀린다.
  await body.locator("img").first().click();
  await captionButton.click();
  await page.keyboard.type("첫째 그림");
  await expect(captions).toHaveText(["그림 1. 첫째 그림", "그림 2. 둘째 그림"]);

  // 캡션에서 Enter를 눌러도 캡션이 둘로 나뉘지 않고 다음 줄로 나간다.
  await page.keyboard.press("Enter");
  await page.keyboard.type("캡션 다음 문단");
  await expect(captions).toHaveCount(2);
  await expect(body.locator("p", { hasText: "캡션 다음 문단" })).not.toHaveAttribute("data-type", "caption");

  // 표: 표 안에 커서를 두고 단축키 → 표 위에 "표 1."
  await body.getByText("본문").click();
  await page.getByRole("button", { name: "표 삽입" }).click();
  await page.keyboard.press("ControlOrMeta+Shift+C");
  await page.keyboard.type("측정 조건");
  const tableCaption = body.locator('p[data-type="caption"][data-kind="table"]');
  await expect(tableCaption).toHaveText("표 1. 측정 조건");
  await expect(tableCaption.locator("xpath=following-sibling::*[1]//table | following-sibling::table[1]").first()).toBeVisible();

  // 같은 그림에서 다시 실행하면 캡션이 늘지 않는다.
  await body.locator("img").first().click();
  await page.keyboard.press("ControlOrMeta+Shift+C");
  await expect(captions).toHaveCount(3);

  // 번호는 문서에 저장되지 않고(계산값), 다시 열어도 같은 번호가 보인다.
  await waitSaved(page);
  const saved = await savedContent(page);
  expect(JSON.stringify(saved)).not.toContain("그림 1");
  expect(saved.content.filter((n) => n.type === "caption").map((n) => n.attrs?.kind)).toEqual(["figure", "figure", "table"]);
  await page.reload();
  await expect(body.locator('p[data-type="caption"][data-kind="figure"]')).toHaveText(["그림 1. 첫째 그림", "그림 2. 둘째 그림"]);
  await expect(tableCaption).toHaveText("표 1. 측정 조건");
});
