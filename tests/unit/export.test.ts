import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as EXPORT } from "@/app/api/docs/[id]/export/route";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { DocContent, DocNode } from "@/lib/editor/content";
import { documentToDocx } from "@/lib/export/docx";
import { documentBodyHtml, exportHtmlDocument } from "@/lib/export/html";
import { documentToMarkdown } from "@/lib/export/markdown";
import { DEFAULT_RULES } from "@/lib/format/rules";
import { contentDisposition, safeFilename } from "@/server/export";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

const t = (text: string, marks?: DocNode["marks"]): DocNode => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
// 1×1 PNG
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** 계약상의 캡션·상호 참조·수식 노드(이 브랜치의 스키마에는 아직 없음)와 알 수 없는 노드가 섞인 문서 */
const sample: DocContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [t("탐구 보고서")] },
    p(t("굵게", [{ type: "bold" }]), t(" 그리고 "), { type: "crossRef", attrs: { targetId: "f2" } }, t(" 참고, "), { type: "mathInline", attrs: { latex: "a^2+b^2" } }),
    { type: "image", attrs: { src: PNG, alt: "장치 사진" } },
    { type: "caption", attrs: { kind: "figure", id: "f1" }, content: [t("실험 장치")] },
    { type: "image", attrs: { src: PNG, alt: "결과" } },
    { type: "caption", attrs: { kind: "figure", id: "f2" }, content: [t("결과 그래프")] },
    { type: "mathBlock", attrs: { latex: "E=mc^2", id: "e1" } },
    { type: "bulletList", content: [{ type: "listItem", content: [p(t("항목 하나"))] }] },
    { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [p(t("첫째"))] }] },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [p(t("변인"))] }, { type: "tableHeader", content: [p(t("값"))] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [p(t("온도"))] }, { type: "tableCell", content: [p(t("25"))] }] },
      ],
    },
    { type: "footnoteBox", attrs: { note: "x" }, content: [p(t("알 수 없는 블록 안의 글"))] },
    { type: "mysteryAtom", attrs: { text: "알 수 없는 atom" } },
    p(t("<script>alert(1)</script>"), t("나쁜 링크", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])),
  ],
};

describe("문서 → HTML (P2-7)", () => {
  it("documentExtensions() 스키마로 HTML을 만들고, 캡션·참조 번호를 문서 순서로 채운다", () => {
    const html = documentBodyHtml(sample);
    expect(html).toContain("<h1>탐구 보고서</h1>");
    expect(html).toContain("<strong>굵게</strong>");
    expect(html).toContain('<span class="caption-label">그림 1.</span> 실험 장치');
    expect(html).toContain('<span class="caption-label">그림 2.</span> 결과 그래프');
    expect(html).toContain('<span data-type="crossRef">그림 2</span>');
    // 수식은 KaTeX MathML로 내보낸다 (원본 LaTeX는 annotation에 남는다).
    expect(html).toMatch(/<span data-type="mathInline"[^>]*><span class="katex"><math/);
    expect(html).toContain('<annotation encoding="application/x-tex">a^2+b^2</annotation>');
    expect(html).toMatch(/<div data-type="mathBlock"[^>]*>.*E=mc\^2.*<span class="math-label">\(1\)<\/span><\/div>/);
    expect(html).toContain("<th");
  });

  it("스키마가 모르는 노드도 조용히 버리지 않고 텍스트로 내보낸다", () => {
    const html = documentBodyHtml(sample);
    expect(html).toContain("알 수 없는 블록 안의 글");
    expect(html).toContain("알 수 없는 atom");
  });

  it("HTML은 sanitize한다", () => {
    const html = documentBodyHtml(sample);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    const doc = exportHtmlDocument({ doc: sample, rules: DEFAULT_RULES, title: '"><img src=x onerror=alert(1)>' });
    expect(doc).not.toContain("<img src=x");
  });

  it("인쇄 HTML에 서식 변수·@page(용지·여백·쪽 번호)를 넣는다", () => {
    const html = exportHtmlDocument({ doc: sample, rules: DEFAULT_RULES, title: "t" });
    expect(html).toContain("size: 210mm 297mm");
    expect(html).toContain("@bottom-center");
    expect(html).toContain("--fmt-body-size: 11pt");
  });
});

describe("문서 → Markdown (P2-7)", () => {
  it("제목·강조·목록·표·캡션 번호·수식을 Markdown으로 쓴다", () => {
    const md = documentToMarkdown(sample);
    expect(md).toContain("# 탐구 보고서");
    expect(md).toContain("**굵게** 그리고 그림 2 참고, $a^2+b^2$");
    expect(md).toContain("*그림 1. 실험 장치*");
    expect(md).toContain("$$\nE=mc^2\n$$ (1)");
    expect(md).toContain("- 항목 하나");
    expect(md).toContain("1. 첫째");
    expect(md).toContain("| 변인 | 값 |\n| --- | --- |\n| 온도 | 25 |");
    expect(md).toContain("알 수 없는 블록 안의 글");
    expect(md).toContain("알 수 없는 atom");
    expect(md).toContain("\\<script\\>");
    expect(md).not.toContain("javascript:");
  });
});

function docxXml(buf: Buffer, part = "word/document.xml"): string {
  const dir = mkdtempSync(path.join(tmpdir(), "docx-"));
  const file = path.join(dir, "a.docx");
  writeFileSync(file, buf);
  return execFileSync("unzip", ["-p", file, part], { encoding: "utf8" });
}

describe("문서 → DOCX (P2-7)", () => {
  it("용지·여백·글꼴·크기·줄 간격·쪽 번호를 반영하고, 모르는 노드도 텍스트로 넣는다", async () => {
    const rules = {
      ...DEFAULT_RULES,
      page: { ...DEFAULT_RULES.page, size: "B5" as const, margin: { top: 20, right: 15, bottom: 20, left: 15 } },
      body: { ...DEFAULT_RULES.body, font: "noto-serif-kr" as const, sizePt: 10, lineHeight: 180 },
    };
    const buf = await documentToDocx(sample, rules, "제목");
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const xml = docxXml(buf);
    expect(xml).toContain('w:w="10318"'); // 182mm
    expect(xml).toContain('w:h="14570"'); // 257mm
    expect(xml).toContain('w:top="1134"'); // 20mm
    for (const text of ["탐구 보고서", "그림 1. ", "실험 장치", "그림 2", "E=mc^2", "알 수 없는 블록 안의 글", "알 수 없는 atom", "온도"]) {
      expect(xml).toContain(text);
    }
    expect(xml).toContain("<w:drawing>");
    const styles = docxXml(buf, "word/styles.xml");
    expect(styles).toContain('w:eastAsia="Noto Serif KR"');
    expect(styles).toContain('<w:sz w:val="20"/>'); // 10pt
    expect(styles).toContain('w:line="432"'); // 180%
    const footer = docxXml(buf, "word/footer1.xml");
    expect(footer).toContain("PAGE");
  });
});

describe("POST /api/docs/:id/export (P2-7)", () => {
  let me: Awaited<ReturnType<typeof createUser>>;
  let other: Awaited<ReturnType<typeof createUser>>;
  let docId: string;
  const call = (id: string, body: unknown) => EXPORT(jsonRequest("POST", `/api/docs/${id}/export`, body), ctx({ id }));

  beforeEach(async () => {
    await resetDb();
    me = await createUser("나");
    other = await createUser("남");
    const project = await prisma.project.create({ data: { ownerId: me.id, title: "p" } });
    docId = (await prisma.document.create({ data: { projectId: project.id, title: "탐구/보고서", contentJson: sample as Prisma.InputJsonValue } })).id;
    loginAs(me);
  });

  it("로그인하지 않으면 401, 남의 문서는 404, 형식이 틀리면 400", async () => {
    loginAs(null);
    expect((await call(docId, { format: "md" })).status).toBe(401);
    loginAs(other);
    const res = await call(docId, { format: "md" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect((await call(docId, { format: "pdf" })).status).toBe(404);
    loginAs(me);
    expect((await call(docId, { format: "hwp" })).status).toBe(400);
    expect((await call("없는문서", { format: "md" })).status).toBe(404);
  });

  it("삭제(휴지통)한 문서는 내보낼 수 없다", async () => {
    await prisma.document.update({ where: { id: docId }, data: { deletedAt: new Date() } });
    expect((await call(docId, { format: "md" })).status).toBe(404);
  });

  it("Markdown·DOCX를 첨부 파일로 돌려준다 (한글 파일 이름)", async () => {
    const md = await call(docId, { format: "md" });
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(md.headers.get("content-disposition")).toContain(`filename*=UTF-8''${encodeURIComponent("탐구_보고서.md")}`);
    expect(await md.text()).toContain("# 탐구 보고서");

    const docx = await call(docId, { format: "docx" });
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-type")).toContain("wordprocessingml");
    expect(Buffer.from(await docx.arrayBuffer()).subarray(0, 2).toString()).toBe("PK");
  });

  it("파일 이름에서 쓸 수 없는 문자를 바꾼다", () => {
    expect(safeFilename('a/b:c*?"<>|')).toBe("a_b_c______");
    expect(safeFilename("   ")).toBe("document");
    expect(contentDisposition("보고서.pdf")).toBe(`attachment; filename="___.pdf"; filename*=UTF-8''${encodeURIComponent("보고서.pdf")}`);
  });
});
