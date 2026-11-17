import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";

// SPEC 13장 시나리오 4: 고충 작성 → 다른 계정으로 댓글·"나도 겪었어요" → 원 작성자가 해결됨 처리
test("E2E-4 고충 작성 → 다른 계정 댓글·공감 → 원 작성자가 해결됨 처리", async ({ browser }) => {
  const title = `설문 표본이 너무 적어요 ${Date.now()}`;

  // 1) 작성자가 고충을 올린다.
  const authorCtx = await browser.newContext();
  const author = await authorCtx.newPage();
  await login(author, uniqueEmail("pain-author"));
  await author.goto("/pains");
  await author.getByRole("link", { name: "고충 쓰기" }).click();
  await expect(author).toHaveURL(/\/pains\/new$/);
  await author.getByLabel("제목").fill(title);
  await author.getByLabel("본문").fill("응답자가 **12명**뿐이라 통계 검정을 못 하겠어요.\n\n- 재조사할 시간은 2주");
  await author.getByLabel("연구 단계").selectOption({ label: "분석" });
  await author.getByLabel("분야").fill("사회");
  await author.getByLabel("태그").fill("통계, 설문");
  await author.getByRole("button", { name: "올리기" }).click();
  await expect(author).toHaveURL(/\/pains\/(?!new$)[a-z0-9]+$/);
  const painPath = new URL(author.url()).pathname;
  await expect(author.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(author.locator("article strong", { hasText: "12명" })).toBeVisible();
  await expect(author.getByText("해결 중")).toBeVisible();

  // 2) 다른 계정이 목록에서 글을 찾아 댓글과 "나도 겪었어요"를 남긴다.
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await login(other, uniqueEmail("pain-other"));
  await other.goto("/pains");
  await other.getByRole("link", { name: title }).click();
  await expect(other).toHaveURL(painPath);
  // 남의 글에는 수정·삭제·해결 처리 도구가 없다.
  await expect(other.getByRole("button", { name: "해결됨으로 표시" })).toHaveCount(0);
  await expect(other.getByRole("button", { name: "삭제" })).toHaveCount(0);

  await other.getByLabel("댓글 쓰기").fill("저도 같은 일을 겪었어요. 비모수 검정을 써 보세요.");
  await other.getByRole("button", { name: "댓글 등록" }).click();
  await expect(other.getByRole("heading", { name: "댓글 1" })).toBeVisible();
  await expect(other.getByText("비모수 검정을 써 보세요")).toBeVisible();

  const meToo = other.getByRole("button", { name: /나도 겪었어요/ });
  await expect(meToo).toHaveAttribute("aria-pressed", "false");
  await meToo.click();
  await expect(meToo).toHaveAttribute("aria-pressed", "true");
  await expect(other.getByTestId("me-too-count")).toHaveText("1");

  // 다른 계정은 API로도 해결됨 처리·수정·삭제를 할 수 없다.
  const forbidden = await other.request.patch(`/api${painPath}`, { data: { resolved: true, resolution: "남이 해결" } });
  expect(forbidden.status()).toBe(403);
  expect((await other.request.delete(`/api${painPath}`)).status()).toBe(403);

  // 3) 원 작성자가 댓글·공감을 확인하고 해결됨으로 바꾼다.
  await author.reload();
  await expect(author.getByText("비모수 검정을 써 보세요")).toBeVisible();
  await expect(author.getByTestId("me-too-count")).toHaveText("1");
  await author.getByRole("textbox", { name: "해결 방법" }).fill("댓글 조언대로 **비모수 검정**(Mann-Whitney)을 썼어요.");
  await author.getByRole("button", { name: "해결됨으로 표시" }).click();

  // 해결 방법이 본문보다 위에 강조 표시된다.
  const resolution = author.getByTestId("pain-resolution");
  await expect(resolution).toBeVisible();
  await expect(resolution.getByRole("heading", { name: "해결 방법" })).toBeVisible();
  await expect(resolution.locator("strong", { hasText: "비모수 검정" })).toBeVisible();
  await expect(author.getByText("해결됨", { exact: true })).toBeVisible();
  const resolutionBox = await resolution.boundingBox();
  const bodyBox = await author.locator("article strong", { hasText: "12명" }).boundingBox();
  expect(resolutionBox && bodyBox && resolutionBox.y < bodyBox.y).toBe(true);

  // 다른 계정과 비로그인 방문자에게도 해결 방법이 보인다.
  await other.reload();
  await expect(other.getByTestId("pain-resolution")).toContainText("Mann-Whitney");
  await other.goto("/pains");
  const row = other.getByRole("listitem").filter({ hasText: title });
  await expect(row.getByText("해결됨", { exact: true })).toBeVisible();

  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(painPath);
  await expect(guest.getByTestId("pain-resolution")).toContainText("Mann-Whitney");
  await expect(guest.getByText("비모수 검정을 써 보세요")).toBeVisible();

  await authorCtx.close();
  await otherCtx.close();
  await guestCtx.close();
});
