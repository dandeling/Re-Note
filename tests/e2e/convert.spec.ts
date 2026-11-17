import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const FIXTURES = path.resolve("tests/fixtures");

test.describe("HWP → PDF 변환 도구 (P3-3)", () => {
  test("로그인 없이 HWPX를 올리면 PDF 미리보기와 내려받기가 나온다", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/tools/convert");
    await expect(page.getByRole("heading", { level: 1, name: "HWP → PDF 변환" })).toBeVisible();
    await expect(page.getByText("레이아웃이 원본과 다를 수 있습니다")).toBeVisible();

    await page.getByLabel("변환할 HWP 또는 HWPX 파일").setInputFiles(path.join(FIXTURES, "hwp/sample.hwpx"));
    await page.getByRole("button", { name: "PDF로 변환" }).click();
    await expect(page.getByRole("status")).toHaveText("변환이 끝났어요.", { timeout: 120_000 });
    await expect(page).toHaveURL(/\?job=[0-9a-f]{32}$/);
    await expect(page.locator('iframe[title="변환 결과 미리보기"]')).toBeVisible();
    await expect(page.getByText("레이아웃이 원본과 다를 수 있습니다")).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "PDF 내려받기" }).click()]);
    expect(download.suggestedFilename()).toBe("sample.pdf");
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

    // 주소(작업 ID)를 아는 다른 브라우저에서도 결과를 볼 수 있다
    const url = page.url();
    const other = await page.context().browser()!.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(url);
    await expect(otherPage.getByRole("status")).toHaveText("변환이 끝났어요.");
    await other.close();

    await page.getByRole("button", { name: "다른 파일 변환" }).click();
    await expect(page.getByLabel("변환할 HWP 또는 HWPX 파일")).toBeVisible();
  });

  test("HWP가 아닌 파일은 올리기 전에 막고, 손상 파일은 실패 사유를 보여 준다", async ({ page }) => {
    await page.goto("/tools/convert");
    const input = page.getByLabel("변환할 HWP 또는 HWPX 파일");
    await input.setInputFiles(path.join(FIXTURES, "import/sample.docx"));
    await page.getByRole("button", { name: "PDF로 변환" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "HWP" })).toHaveText("HWP(.hwp) 또는 HWPX(.hwpx) 파일만 변환할 수 있습니다.");

    await input.setInputFiles(path.join(FIXTURES, "hwp/corrupt.hwp"));
    await page.getByRole("button", { name: "PDF로 변환" }).click();
    await expect(page.getByRole("status")).toHaveText("변환하지 못했어요.", { timeout: 60_000 });
    await expect(page.getByText(/사유: 파일이 손상되었거나/)).toBeVisible();
  });
});
