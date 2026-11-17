import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";

// SPEC 13장 시나리오 6: 챗봇에 "○○ 관련 연구 있어?" → 내부 검색 결과 링크로 답변 / 없는 주제는 "없음"으로 답변.
// 챗봇의 search_site는 lib/search의 searchSite에 연결돼 있고, E2E 서버는 AI_FAKE=1이다.
test("E2E-6 공개한 연구를 챗봇이 내부 검색 링크로 알려 주고, 없는 주제는 없다고 답한다", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const topic = `음향블랙홀${Date.now()}`;
  const title = `${topic} 쐐기형 판의 진동 감쇠`;

  // 1) 작성자가 연구를 공개한다
  await login(page, uniqueEmail("scenario6-author"));
  await page.goto("/projects");
  await page.getByLabel("제목").fill(title);
  await page.getByLabel("설명").fill("끝을 얇게 깎은 판으로 굽힘파를 가두어 진동을 줄였다.");
  await page.getByLabel("키워드").fill(`${topic}, 진동 감쇠`);
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByRole("link", { name: "연구 공개하기" }).click();
  await expect(page.getByLabel("연구 제목")).toHaveValue(title, { timeout: 30_000 });
  await page.getByRole("button", { name: "공개 전 확인" }).click();
  await page.getByRole("dialog", { name: "이 연구를 공개할까요?" }).getByRole("button", { name: "공개하기" }).click();
  await expect(page).toHaveURL(/\/research\/[a-z0-9]+$/, { timeout: 30_000 });
  const researchId = new URL(page.url()).pathname.split("/").pop()!;

  // 2) 다른 사용자가 챗봇에 묻는다
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "ko-KR" });
  const page2 = await other.newPage();
  await login(page2, uniqueEmail("scenario6-asker"));
  await page2.goto("/");
  await page2.getByRole("button", { name: "AI 도우미 열기" }).click();
  const dialog = page2.getByRole("dialog", { name: "AI 도우미" });
  const input = dialog.getByLabel("AI 도우미에게 보낼 메시지");

  await input.fill(`${topic} 관련 연구 있어?`);
  await input.press("Enter");
  const found = dialog.locator('li[data-role="assistant"]').first();
  // (같은 E2E DB에 이전 실행의 비슷한 연구가 남아 있을 수 있어 건수는 고정하지 않는다)
  await expect(found).toContainText(/사이트에서 \d+건을 찾았습니다/, { timeout: 20_000 });
  await expect(found).toContainText(`「${title}」`);
  const link = found.getByRole("navigation", { name: "출처" }).getByRole("link", { name: title });
  await expect(link).toHaveAttribute("href", `/research/${researchId}`);

  await input.fill(`없는주제${Date.now()} 관련 연구 있어?`);
  await input.press("Enter");
  const none = dialog.locator('li[data-role="assistant"]').last();
  await expect(none).toContainText("사이트에서 관련 연구를 찾지 못했습니다", { timeout: 20_000 });
  await expect(none.getByRole("link")).toHaveCount(0);

  // 링크를 따라가면 그 연구 상세가 열린다
  await link.click();
  await expect(page2).toHaveURL(`/research/${researchId}`, { timeout: 30_000 });
  await expect(page2.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await other.close();
});
