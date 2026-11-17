import { expect, test } from "@playwright/test";
import { login, uniqueEmail } from "./helpers";

// SPEC 13장 시나리오 7: 타 사용자의 프로젝트 URL 직접 접근 → 404
test("E2E-7 타 사용자의 프로젝트 URL에 직접 접근하면 404", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await login(owner, uniqueEmail("owner"));
  await owner.goto("/projects");
  await owner.getByLabel("제목").fill("남이 보면 안 되는 연구");
  await owner.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(owner).toHaveURL(/\/projects\/[a-z0-9]+$/);
  const projectUrl = new URL(owner.url()).pathname;

  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await login(other, uniqueEmail("other"));
  const res = await other.goto(projectUrl);
  expect(res?.status()).toBe(404);
  await expect(other.getByRole("heading", { name: "페이지를 찾을 수 없어요" })).toBeVisible();
  await expect(other.getByText("남이 보면 안 되는 연구")).toHaveCount(0);

  const apiRes = await other.request.get(`/api${projectUrl}`);
  expect(apiRes.status()).toBe(404);

  await ownerCtx.close();
  await otherCtx.close();
});
