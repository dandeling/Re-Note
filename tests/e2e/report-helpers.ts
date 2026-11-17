import { expect, type Page } from "@playwright/test";

const svg = (label: string) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><rect width="160" height="60" fill="#dbeafe"/><text x="12" y="36">${label}</text></svg>`,
  ).toString("base64")}`;

export const image = (label: string) => ({ type: "image", attrs: { src: svg(label), alt: label } });
export const paragraph = (text = "") => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) });

export function docId(page: Page) {
  return new URL(page.url()).pathname.split("/").pop() as string;
}

/** 방금 만든 문서(버전 1)의 내용을 API로 채우고 다시 연다. (그림 업로드 UI는 다른 Phase 담당) */
export async function seedDocument(page: Page, content: unknown[]) {
  const res = await page.request.patch(`/api/docs/${docId(page)}`, {
    data: { contentJson: { type: "doc", content }, baseVersion: 1 },
  });
  expect(res.ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toBeVisible();
}

/** 서버에 저장된 문서 JSON */
export async function savedContent(page: Page) {
  const res = await page.request.get(`/api/docs/${docId(page)}`);
  return (await res.json()).document.contentJson as { content: { type: string; attrs?: Record<string, unknown> }[] };
}

export async function waitSaved(page: Page) {
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("save-status")).toContainText("저장됨", { timeout: 10_000 });
}

/**
 * 프로젝트와 문서를 만들고 에디터까지 간다. `helpers.ts`의 createProjectAndDoc과 같지만,
 * 개발 서버가 화면을 처음 컴파일하는 동안을 넉넉히 기다린다 (수식·캡션 확장으로 에디터 번들이 커졌다).
 */
export async function openNewDoc(page: Page, title = "보고서 도우미 테스트") {
  await page.goto("/projects");
  await page.getByLabel("제목").fill(title);
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "새 문서" }).click();
  await expect(page).toHaveURL(/\/docs\/[a-z0-9]+$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toBeVisible({ timeout: 30_000 });
}
