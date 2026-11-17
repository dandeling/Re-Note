import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { POST as EXPORT } from "@/app/api/docs/[id]/export/route";
import { PATCH as PATCH_DOC } from "@/app/api/docs/[id]/route";
import { POST as SAVE_TEMPLATE } from "@/app/api/format-templates/route";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { DocNode } from "@/lib/editor/content";
import { FORMAT_PRESETS } from "@/lib/format/presets";
import { DEFAULT_RULES, type FormatRules } from "@/lib/format/rules";
import { ensureFormatPresets } from "@/server/format-templates";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

/**
 * P2-8 완료 기준(SPEC 7.3): "서식 규칙을 바꾸면 … PDF 내보내기 결과에도 동일하게 적용된다".
 * 실제 Chromium으로 PDF를 만들고 poppler(pdfinfo, pdffonts, pdftotext)로 용지·글꼴·쪽 번호를 확인한다.
 */
const PT_PER_MM = 72 / 25.4;
/** Chromium은 용지 크기를 CSS px(1/96인치) 단위로 반올림하므로 1pt까지 오차를 허용한다. */
const expectMm = (pt: number, mm: number) => expect(Math.abs(pt - mm * PT_PER_MM)).toBeLessThan(1);
const para = (text: string): DocNode => ({ type: "paragraph", content: [{ type: "text", text }] });
// 2쪽 이상이 되도록 긴 문서
const content = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "서식 반영 확인" }] },
    ...Array.from({ length: 40 }, (_, i) => para(`${i + 1}번째 문단입니다. 서식 규칙이 PDF에도 똑같이 적용되는지 확인하는 긴 문장입니다.`)),
  ],
};

function pdfTool(tool: string, pdf: Buffer, ...args: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pdf-"));
  const file = path.join(dir, "out.pdf");
  writeFileSync(file, pdf);
  return execFileSync(tool, [...args, file, ...(tool === "pdftotext" ? ["-"] : [])], { encoding: "utf8" });
}

function pageSizePt(pdf: Buffer): { width: number; height: number; pages: number } {
  const info = pdfTool("pdfinfo", pdf);
  const m = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info)!;
  return { width: Number(m[1]), height: Number(m[2]), pages: Number(/Pages:\s+(\d+)/.exec(info)![1]) };
}

describe("서식 규칙 → PDF 내보내기 (P2-8)", () => {
  let docId: string;
  const exportPdf = async () => {
    const res = await EXPORT(jsonRequest("POST", `/api/docs/${docId}/export`, { format: "pdf" }), ctx({ id: docId }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    return Buffer.from(await res.arrayBuffer());
  };
  const applyRules = async (rules: FormatRules) => {
    const saved = await SAVE_TEMPLATE(jsonRequest("POST", "/api/format-templates", { name: "내 양식", rulesJson: rules }), undefined);
    const { template } = await saved.json();
    const res = await PATCH_DOC(jsonRequest("PATCH", `/api/docs/${docId}`, { formatTemplateId: template.id }), ctx({ id: docId }));
    expect(res.status).toBe(200);
  };

  beforeAll(async () => {
    await resetDb();
    await ensureFormatPresets(); // 시드와 같다
    const me = await createUser("나");
    loginAs(me);
    const project = await prisma.project.create({ data: { ownerId: me.id, title: "p" } });
    docId = (await prisma.document.create({ data: { projectId: project.id, title: "보고서", contentJson: content as Prisma.InputJsonValue } })).id;
  });

  it("기본(일반 보고서): A4 세로, Noto Sans KR 글꼴이 PDF에 들어가고 쪽 번호가 찍힌다", async () => {
    const pdf = await exportPdf();
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const size = pageSizePt(pdf);
    expectMm(size.width, 210);
    expectMm(size.height, 297);
    expect(size.pages).toBeGreaterThanOrEqual(2);
    const fonts = pdfTool("pdffonts", pdf);
    expect(fonts).toMatch(/NotoSansKR/);
    expect(fonts).not.toMatch(/NanumMyeongjo|NotoSerifKR/);
    const text = pdfTool("pdftotext", pdf, "-layout");
    expect(text).toContain("서식 반영 확인");
    const pages = text.split("\f").filter((s) => s.trim());
    // 쪽 번호 모양 "n": 각 쪽 마지막 줄이 쪽 번호
    pages.forEach((page, i) => expect(page.trim().split("\n").at(-1)!.trim()).toBe(String(i + 1)));
  }, 120_000);

  it("규칙을 바꾸면(용지 B5 가로, 나눔명조, 쪽 번호 '- n -', 여백) PDF도 같이 바뀐다", async () => {
    await applyRules({
      ...DEFAULT_RULES,
      page: { size: "B5", orientation: "landscape", margin: { top: 15, right: 15, bottom: 15, left: 15 } },
      body: { ...DEFAULT_RULES.body, font: "nanum-myeongjo", sizePt: 12 },
      headings: Object.fromEntries(
        Object.entries(DEFAULT_RULES.headings).map(([k, v]) => [k, { ...v, font: "nanum-myeongjo" }]),
      ) as FormatRules["headings"],
      pageNumber: { enabled: true, position: "bottom-center", style: "dash" },
    });
    const pdf = await exportPdf();
    const size = pageSizePt(pdf);
    expectMm(size.width, 257);
    expectMm(size.height, 182);
    const fonts = pdfTool("pdffonts", pdf);
    expect(fonts).toMatch(/NanumMyeongjo/);
    expect(fonts).not.toMatch(/NotoSansKR/);
    const text = pdfTool("pdftotext", pdf, "-layout");
    // pdftotext는 작은 글자 사이 공백을 빼고 읽기도 한다
    expect(text).toMatch(/^\s*-\s?1\s?-\s*$/m);
    expect(text).toMatch(/^\s*-\s?2\s?-\s*$/m);
  }, 120_000);

  it("프리셋(학술 논문형)을 적용하면 Noto Serif KR로 바뀌고, 쪽 번호를 끄면 찍히지 않는다", async () => {
    let res = await PATCH_DOC(jsonRequest("PATCH", `/api/docs/${docId}`, { formatTemplateId: "preset-academic" }), ctx({ id: docId }));
    expect(res.status).toBe(200);
    let pdf = await exportPdf();
    expect(pdfTool("pdffonts", pdf)).toMatch(/NotoSerifKR/);
    expect(pdfTool("pdftotext", pdf, "-layout")).toMatch(/^\s*-\s?1\s?-\s*$/m);

    await applyRules({ ...FORMAT_PRESETS[1].rules, pageNumber: { ...FORMAT_PRESETS[1].rules.pageNumber, enabled: false } });
    pdf = await exportPdf();
    const text = pdfTool("pdftotext", pdf, "-layout");
    expect(text).toContain("40번째 문단입니다.");
    expect(text).not.toMatch(/^\s*-?\s?\d+\s?-?\s*$/m);
    res = await PATCH_DOC(jsonRequest("PATCH", `/api/docs/${docId}`, { formatTemplateId: null }), ctx({ id: docId }));
    expect(res.status).toBe(200);
  }, 120_000);
});
