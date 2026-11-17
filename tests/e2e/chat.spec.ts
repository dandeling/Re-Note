import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL } from "../../playwright.config";
import { createProjectAndDoc, login, uniqueEmail } from "./helpers";

// E2E 서버는 AI_FAKE=1(lib/ai/fake.ts)로 떠 있어 실제 AI를 부르지 않는다.
// 테스트 데이터는 E2E DB에 직접 SQL로 넣고 확인한다 (Playwright 러너에서는 생성된 Prisma 클라이언트를 불러올 수 없다).

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

async function userIdOf(email: string) {
  const [row] = await sql<{ id: string }>(`SELECT id FROM "User" WHERE email = $1`, [email]);
  return row.id;
}

async function openChat(page: Page) {
  await page.getByRole("button", { name: "AI 도우미 열기" }).click();
  const dialog = page.getByRole("dialog", { name: "AI 도우미" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function ask(page: Page, message: string) {
  const dialog = page.getByRole("dialog", { name: "AI 도우미" });
  await dialog.getByLabel("AI 도우미에게 보낼 메시지").fill(message);
  await dialog.getByLabel("AI 도우미에게 보낼 메시지").press("Enter");
  return dialog.locator('li[data-role="assistant"]').last();
}

test("플로팅 챗봇 버튼은 모든 페이지에 있고, 비로그인이면 로그인 안내를 보여준다", async ({ page }) => {
  for (const path of ["/", "/explore", "/pains", "/login"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "AI 도우미 열기" })).toBeVisible();
  }
  const dialog = await openChat(page);
  await expect(dialog.getByText("AI 도우미는 로그인 후 사용할 수 있어요.")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "로그인하기" })).toHaveAttribute("href", "/login");
  await expect(dialog.getByLabel("AI 도우미에게 보낼 메시지")).toHaveCount(0);
});

test("키보드만으로 열고, 보내고, Escape로 닫으면 버튼으로 초점이 돌아온다", async ({ page }) => {
  await login(page, uniqueEmail("chat-kbd"));
  await page.goto("/");
  const button = page.getByRole("button", { name: "AI 도우미 열기" });
  await button.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "AI 도우미" });
  const input = dialog.getByLabel("AI 도우미에게 보낼 메시지");
  await expect(input).toBeFocused();
  await page.keyboard.type("줄 하나");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("줄 둘");
  await expect(input).toHaveValue("줄 하나\n줄 둘");
  await page.keyboard.press("Enter");
  await expect(dialog.locator('li[data-role="assistant"]').last()).toContainText("가짜 AI 응답입니다: 줄 하나\n줄 둘");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "AI 도우미 열기" })).toBeFocused();

  // 다시 열면 대화가 남아 있다
  await page.keyboard.press("Enter");
  await expect(dialog.locator('li[data-role="user"]')).toHaveCount(1);
});

test("답변이 스트리밍으로 조금씩 나타난다", async ({ page }) => {
  await login(page, uniqueEmail("chat-stream"));
  await page.goto("/");
  await openChat(page);
  const long = "스트리밍 확인용으로 충분히 긴 문장을 보냅니다. ".repeat(6).trim();
  const reply = await ask(page, long);

  // 쓰는 동안: 진행 표시와 중지 버튼이 보이고, 답변은 아직 일부만 와 있다
  await expect(reply.getByTestId("chat-status")).toHaveText("답변을 쓰는 중…");
  await expect(page.getByRole("button", { name: "중지" })).toBeVisible();
  const full = `가짜 AI 응답입니다: ${long}`;
  await expect.poll(async () => (await reply.getByTestId("chat-text").textContent())?.length ?? 0).toBeGreaterThan(0);
  const partial = (await reply.getByTestId("chat-text").textContent()) ?? "";
  expect(partial.length).toBeLessThan(full.length);
  expect(full.startsWith(partial)).toBe(true);

  await expect(reply.getByTestId("chat-text")).toHaveText(full);
  await expect(reply.getByTestId("chat-status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "중지" })).toHaveCount(0);
});

test("\"○○ 관련 연구 있어?\"에 사이트 내부 검색 결과와 출처 링크로 답하고, 없으면 없다고 답한다", async ({ page }) => {
  const email = uniqueEmail("chat-search");
  await login(page, email);
  const authorId = await userIdOf(email);
  const topic = `음향블랙홀${Date.now()}`;
  const research = { id: `e2e${randomUUID().replaceAll("-", "")}` };
  await sql(`INSERT INTO "Research" (id, "authorId", title, summary, keywords) VALUES ($1, $2, $3, $4, $5)`, [
    research.id,
    authorId,
    `${topic} 진동 감쇠 실험`,
    "쐐기형 판으로 진동을 줄였다.",
    [topic],
  ]);
  const pain = { id: `e2e${randomUUID().replaceAll("-", "")}` };
  await sql(
    `INSERT INTO "PainPost" (id, "authorId", title, body, tags, "isAnonymous", "updatedAt") VALUES ($1, $2, $3, $4, $5, true, now())`,
    [pain.id, authorId, `${topic} 가공이 어려워요`, "끝을 얇게 깎기가 어렵습니다.", []],
  );

  await page.goto("/");
  const dialog = await openChat(page);
  const found = await ask(page, `${topic} 관련 연구 있어?`);
  // 공용 E2E DB에 이전 실행의 비슷한 연구가 남아 있을 수 있어 건수는 고정하지 않는다.
  await expect(found).toContainText(/사이트에서 \d+건을 찾았습니다/);
  const sources = found.getByRole("navigation", { name: "출처" });
  await expect(sources.getByRole("link", { name: `${topic} 진동 감쇠 실험` })).toHaveAttribute("href", `/research/${research.id}`);
  await expect(sources.getByRole("link", { name: `${topic} 가공이 어려워요` })).toHaveAttribute("href", `/pains/${pain.id}`);
  // 익명 글의 작성자 정보는 어디에도 나오지 않는다
  await expect(dialog).not.toContainText(email);

  const none = await ask(page, `없는주제${Date.now()} 관련 연구 있어?`);
  await expect(none).toContainText("사이트에서 관련 연구를 찾지 못했습니다");
  await expect(none.getByRole("navigation", { name: "출처" })).toHaveCount(0);
  await expect(none.getByRole("link")).toHaveCount(0);

  // 스레드 이어가기: 새로고침 후 이전 대화를 고르면 메시지와 출처가 다시 보인다
  await page.reload();
  await openChat(page);
  const threads = dialog.getByLabel("이전 대화");
  await threads.selectOption({ label: `${topic} 관련 연구 있어?` });
  await expect(dialog.locator('li[data-role="user"]')).toHaveCount(2);
  await expect(
    dialog.locator('li[data-role="assistant"]').first().getByRole("link", { name: `${topic} 진동 감쇠 실험` }),
  ).toHaveAttribute("href", `/research/${research.id}`);

  const more = await ask(page, "이어서 질문");
  await expect(more).toContainText("가짜 AI 응답입니다: 이어서 질문");
  const threads2 = await sql<{ id: string }>(`SELECT id FROM "ChatThread" WHERE "userId" = $1`, [authorId]);
  expect(threads2).toHaveLength(1);
  const [{ n }] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "ChatMessage" WHERE "threadId" = $1`, [threads2[0].id]);
  expect(n).toBe(6);

  // 새 대화를 누르면 비워진다
  await dialog.getByRole("button", { name: "새 대화" }).click();
  await expect(dialog.locator("li[data-role]")).toHaveCount(0);
});

test("에디터에서 \"다듬어줘\"는 제안만 보여주고 문서를 자동으로 바꾸지 않는다", async ({ page }) => {
  await login(page, uniqueEmail("chat-suggest"));
  await createProjectAndDoc(page, "챗봇 제안 프로젝트");
  const body = page.getByRole("textbox", { name: "문서 본문" });
  await body.click();
  await page.keyboard.type("원래 문단입니다.");
  await expect(page.getByText(/저장됨/)).toBeVisible();
  const docId = page.url().split("/").pop()!;
  const readDoc = async () =>
    (await sql<{ version: number; contentJson: unknown }>(`SELECT version, "contentJson" FROM "Document" WHERE id = $1`, [docId]))[0];
  const before = await readDoc();

  // 에디터에서는 플로팅 버튼 대신 우측 패널의 AI 도우미를 쓴다 (SPEC 5장)
  await expect(page.getByRole("button", { name: "AI 도우미 열기" })).toHaveCount(0);
  await page.getByRole("button", { name: "AI 도우미", exact: true }).click();
  const panel = page.getByTestId("editor-chat");
  await panel.getByLabel("AI 도우미에게 보낼 메시지").fill("이 문단 다듬어줘");
  await panel.getByLabel("AI 도우미에게 보낼 메시지").press("Enter");
  const reply = panel.locator('li[data-role="assistant"]').last();
  const card = reply.getByTestId("chat-suggestion");
  await expect(card).toContainText("문서에 넣을 글 제안");
  await expect(card).toContainText("[다듬은 글] 이 문단 다듬어줘");
  await expect(reply).toContainText("제안을 준비했습니다.");

  // 서버는 문서를 바꾸지 않는다: 화면도 DB도 그대로
  await expect(body).toHaveText("원래 문단입니다.");
  const after = await readDoc();
  expect(after.version).toBe(before.version);
  expect(after.contentJson).toEqual(before.contentJson);
  // 현재 문서가 스레드의 컨텍스트로 기록된다
  const linked = await sql(`SELECT id FROM "ChatThread" WHERE "documentId" = $1`, [docId]);
  expect(linked).toHaveLength(1);
});
