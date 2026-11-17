import type { DocContent } from "@/lib/editor/content";
import { documentToDocx } from "@/lib/export/docx";
import { exportHtmlDocument } from "@/lib/export/html";
import { documentToMarkdown } from "@/lib/export/markdown";
import { pdfExportEnabled } from "@/lib/features";
import { usedFonts } from "@/lib/format/css";
import type { FormatRules } from "@/lib/format/rules";
import { messages } from "@/lib/messages";
import type { ExportFormat } from "@/lib/validation/format";
import { ApiError } from "@/server/api";
import { fontFaceCss, readFontFile } from "@/server/format-fonts";

/**
 * 문서 내보내기 (SPEC 7.5, P2-7). PDF는 Playwright(Chromium) 인쇄, DOCX는 docx, Markdown은 직접 직렬화.
 *
 * Playwright는 PDF를 만들 때만 불러온다(동적 import). Chromium이 없는 서버리스(Vercel)에서는
 * `pdfExportEnabled()`가 false라 PDF 요청을 501로 거절하고, 다른 형식은 Playwright 없이 동작한다.
 */

/** PDF용 글꼴 주소. 실제로 네트워크로 나가지 않고 page.route가 디스크의 글꼴 파일로 응답한다. */
const FONT_ORIGIN = "https://fonts.export.invalid";
const PDF_TIMEOUT_MS = 60_000;

/** PDF 내보내기를 끈 배포에서는 501 (NOT_IMPLEMENTED) */
export function assertPdfExport() {
  if (!pdfExportEnabled()) {
    throw new ApiError("NOT_IMPLEMENTED", messages.exporter.pdfDisabled, { reason: "PDF_EXPORT_DISABLED" });
  }
}

export async function documentToPdf(doc: DocContent, rules: FormatRules, title: string): Promise<Buffer> {
  assertPdfExport();
  const { chromium } = await import("playwright");
  const fontCss = await fontFaceCss(usedFonts(rules), FONT_ORIGIN);
  const html = exportHtmlDocument({ doc, rules, title, fontCss });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    page.setDefaultTimeout(PDF_TIMEOUT_MS);
    // 글꼴 말고는 어떤 요청도 내보내지 않는다(문서 속 외부 주소로 서버가 요청하지 않게: SSRF 방지).
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === FONT_ORIGIN) {
        const [, pkg, file] = url.pathname.split("/");
        const font = await readFontFile(pkg ?? "", file ?? "");
        if (font) return route.fulfill({ status: 200, body: font.data, contentType: font.contentType });
      }
      return route.abort();
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown; charset=utf-8",
};

export async function exportDocument(
  format: ExportFormat,
  doc: { title: string; contentJson: DocContent },
  rules: FormatRules,
): Promise<{ body: Buffer; contentType: string; filename: string }> {
  const body =
    format === "pdf"
      ? await documentToPdf(doc.contentJson, rules, doc.title)
      : format === "docx"
        ? await documentToDocx(doc.contentJson, rules, doc.title)
        : Buffer.from(documentToMarkdown(doc.contentJson), "utf8");
  return { body, contentType: CONTENT_TYPES[format], filename: `${safeFilename(doc.title)}.${format}` };
}

/** 파일 이름으로 쓸 수 없는 문자를 바꾼다 */
export function safeFilename(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 100);
  return name || "document";
}

/** Content-Disposition (한글 파일 이름은 RFC 5987 filename*) */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
