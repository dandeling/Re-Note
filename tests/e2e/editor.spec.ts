import { expect, test } from "@playwright/test";
import { createProjectAndDoc, login, uniqueEmail } from "./helpers";

test("문서를 만들어 서식 있는 내용을 쓰고 저장하면 다시 열어도 그대로다", async ({ page }) => {
  await login(page, uniqueEmail("editor"));
  await createProjectAndDoc(page);

  await page.getByLabel("문서 제목").fill("진동 감쇠 결과보고서");
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await body.click();
  await page.getByRole("button", { name: "제목 1" }).click();
  await page.keyboard.type("서론");
  await page.keyboard.press("Enter");
  await page.keyboard.type("음향 블랙홀의 진동 감쇠를 측정했다.");
  // 저장 버튼 없이, 입력을 멈추면 자동 저장된다.
  await expect(page.getByTestId("save-status")).toHaveText("변경됨");
  await expect(page.getByTestId("save-status")).toContainText(/저장됨 \d{2}:\d{2}/, { timeout: 8000 });

  await page.reload();
  await expect(page.getByLabel("문서 제목")).toHaveValue("진동 감쇠 결과보고서");
  await expect(page.getByRole("heading", { level: 1, name: "서론" })).toBeVisible();
  await expect(page.getByText("음향 블랙홀의 진동 감쇠를 측정했다.")).toBeVisible();

  await page.getByRole("link", { name: /프로젝트로 돌아가기/ }).click();
  await expect(page.getByRole("link", { name: "진동 감쇠 결과보고서" })).toBeVisible();
});

test("키보드만으로 굵게·목록·실행 취소를 쓸 수 있다", async ({ page }) => {
  await login(page, uniqueEmail("kbd"));
  await createProjectAndDoc(page);
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await body.click();
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("굵은 글씨");
  await expect(body.locator("strong")).toHaveText("굵은 글씨");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- 항목");
  await expect(body.locator("ul li")).toHaveText("항목");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("save-status")).toContainText("저장됨");
});

test("버전 충돌: 두 탭에서 같은 문서를 고치면 충돌을 안내하고 선택대로 처리한다", async ({ page, context }) => {
  await login(page, uniqueEmail("conflict"));
  await createProjectAndDoc(page);
  const url = page.url();
  const other = await context.newPage();
  await other.goto(url);

  // 탭 A가 먼저 저장
  await page.getByRole("textbox", { name: "문서 본문" }).click();
  await page.keyboard.type("탭 A의 내용");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("save-status")).toContainText("저장됨");

  // 탭 B는 옛 버전을 기준으로 저장 → 충돌
  await other.getByRole("textbox", { name: "문서 본문" }).click();
  await other.keyboard.type("탭 B의 내용");
  await other.keyboard.press("ControlOrMeta+s");
  await expect(other.getByTestId("conflict-banner")).toContainText("다른 곳에서 이 문서가 먼저 수정되었어요");

  // 서버 버전 불러오기 → 탭 A의 내용으로 바뀐다
  await other.getByRole("button", { name: "서버 버전 불러오기" }).click();
  await expect(other.getByRole("textbox", { name: "문서 본문" })).toHaveText("탭 A의 내용");
  await expect(other.getByTestId("conflict-banner")).toHaveCount(0);

  // 이번엔 탭 A가 옛 버전이 되도록 탭 B가 저장한 뒤, 탭 A에서 "내 버전 유지"
  await other.keyboard.type(" + B 추가");
  await other.keyboard.press("ControlOrMeta+s");
  await expect(other.getByTestId("save-status")).toContainText("저장됨");
  await page.getByRole("textbox", { name: "문서 본문" }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" (A가 덮어씀)");
  await page.keyboard.press("ControlOrMeta+s");
  await page.getByRole("button", { name: "내 버전 유지" }).click();
  await expect(page.getByTestId("save-status")).toContainText("저장됨");
  await other.reload();
  await expect(other.getByRole("textbox", { name: "문서 본문" })).toHaveText("탭 A의 내용 (A가 덮어씀)");
});
