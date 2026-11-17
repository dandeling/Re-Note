import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { E2E_DATABASE_URL } from "../../playwright.config";
import { login, uniqueEmail } from "./helpers";

// 연구 공개 → 다른 계정이 키워드 검색 → 연구 상세에서 고충·한계 확인 (SPEC 7.2, P6-1·P6-4·P6-6)
// 연구에 연결된 고충은 DB에 직접 넣는다(고충 작성 화면은 scenario-5에서 확인). 익명 글은 연구에 연결할 수 없으므로 실명 글이다.
async function insertLinkedPain(researchId: string, authorEmail: string, title: string) {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM "User" WHERE email = $1`, [authorEmail]);
    await client.query(
      `INSERT INTO "PainPost" (id, "authorId", "researchId", title, body, stage, "isAnonymous", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'EXPERIMENT', false, now())`,
      [`e2e${randomUUID().replace(/-/g, "")}`, rows[0].id, researchId, title, "자석 간격을 맞추기 어렵습니다."],
    );
  } finally {
    await client.end();
  }
}

test("연구를 공개하면 다른 계정이 띄어쓰기·오타가 있는 키워드로 찾아 상세에서 고충·한계를 본다", async ({ page, browser }) => {
  const tag = `${Date.now()}`;
  const title = `자기부상 열차 축소 모형의 부상 높이 측정 ${tag}`;
  const authorEmail = uniqueEmail("publisher");

  // 1) 작성자: 프로젝트 → 연구 공개하기 → 확인 모달 → 공개
  await login(page, authorEmail);
  await page.goto("/projects");
  await page.getByLabel("제목").fill(title);
  await page.getByLabel("설명").fill("네오디뮴 자석 레일 위에서 초전도체 대신 반자성 흑연으로 부상 높이를 측정했다.");
  await page.getByLabel("키워드").fill("자기부상 열차, 반자성 흑연");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/, { timeout: 30_000 });

  await page.getByRole("link", { name: "연구 공개하기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "연구 공개하기" })).toBeVisible();
  await expect(page.getByLabel("연구 제목")).toHaveValue(title);
  await expect(page.getByLabel("키워드")).toHaveValue("자기부상 열차, 반자성 흑연");
  await page.getByLabel("한계").fill("레일 길이가 30 cm라 주행 중 부상 높이는 재지 못했다.");
  await page.getByRole("button", { name: "공개 전 확인" }).click();

  const dialog = page.getByRole("dialog", { name: "이 연구를 공개할까요?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "공개 전 확인" }).click();
  await dialog.getByRole("button", { name: "공개하기" }).click();

  await expect(page).toHaveURL(/\/research\/[a-z0-9]+$/, { timeout: 30_000 });
  const researchId = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await insertLinkedPain(researchId, authorEmail, `흑연 판이 자꾸 기울어요 ${tag}`);

  // 2) 다른 계정: 띄어쓰기를 붙이고 한 글자 오타가 있는 키워드로 검색
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await login(page2, uniqueEmail("searcher"));
  await page2.goto("/");
  await page2.getByLabel("사이트 내 검색어").fill("자기부상열차 반자성 흑엽");
  await page2.getByRole("button", { name: "검색" }).click();
  await expect(page2).toHaveURL(/\/explore\?q=/, { timeout: 30_000 });

  const card = page2.getByTestId("research-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByText("고충 1건")).toBeVisible();
  await expect(card.getByText("결과보고서 없음")).toBeVisible();
  await expect(card.getByText(/^한계: 레일 길이가 30 cm/)).toBeVisible();
  await expect(card.getByText(/유사도 \d+%/)).toBeVisible();
  await card.getByRole("link", { name: title }).click();

  // 3) 연구 상세: 요약·한계·연결된 고충(이메일 비노출)·결과보고서 영역
  await expect(page2).toHaveURL(`/research/${researchId}`, { timeout: 30_000 });
  // 이전 실행에서 공개한 같은 내용의 연구가 "비슷한 연구"에 나올 수 있으므로 영역을 한정한다.
  await expect(page2.getByRole("region", { name: "한계" })).toContainText("레일 길이가 30 cm라 주행 중 부상 높이는 재지 못했다.");
  await expect(page2.getByRole("region", { name: "요약" })).toContainText("반자성 흑연");
  await expect(page2.getByRole("heading", { name: "연결된 고충 1건" })).toBeVisible();
  const pain = page2.getByTestId("research-pains").getByRole("link", { name: `흑연 판이 자꾸 기울어요 ${tag}` });
  await expect(pain).toHaveAttribute("href", /^\/pains\/e2e/);
  await expect(page2.getByText("등록된 결과보고서가 없어요.")).toBeVisible();
  await expect(page2.getByText(authorEmail)).toHaveCount(0);
  await other.close();
});

test("비로그인도 검색할 수 있고, 결과가 없으면 없다고 분명히 표시한다", async ({ page }) => {
  await page.goto(`/explore?q=${encodeURIComponent("쿼크 글루온 플라스마 qqzz")}`);
  await expect(page.getByRole("status")).toContainText("아직 이 사이트에 등록된 연구가 없어요");
  await expect(page.getByTestId("research-card")).toHaveCount(0);
});

test("남의 프로젝트의 공개 화면은 404", async ({ page, browser }) => {
  await login(page, uniqueEmail("owner"));
  await page.goto("/projects");
  await page.getByLabel("제목").fill("남이 공개하면 안 되는 프로젝트");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/, { timeout: 30_000 });
  const projectId = page.url().split("/").pop()!;

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await login(page2, uniqueEmail("intruder"));
  const res = await page2.goto(`/projects/${projectId}/publish`);
  expect(res?.status()).toBe(404);
  await other.close();
});
