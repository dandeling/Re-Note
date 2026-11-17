import { open, stat } from "node:fs/promises";
import { runProcess } from "./run";

export type PdfInfo = {
  valid: boolean;
  /** 쪽수. poppler가 없어 알 수 없으면 null */
  pages: number | null;
  /** 글자가 하나라도 추출되는가. poppler가 없어 알 수 없으면 null */
  hasText: boolean | null;
  textLength: number;
};

const INVALID: PdfInfo = { valid: false, pages: 0, hasText: false, textLength: 0 };

/**
 * 변환 결과 PDF를 검사한다. 종료 코드만 믿지 않는다 (docs/hwp-spike.md 3.1: 종료 코드 0인 빈 PDF).
 * pdfinfo로 쪽수, pdftotext로 글자 유무를 본다.
 */
export async function inspectPdf(pdfPath: string, timeoutMs = 30_000): Promise<PdfInfo> {
  try {
    const info = await stat(pdfPath);
    if (!info.isFile() || info.size < 100) return INVALID;
    const handle = await open(pdfPath, "r");
    try {
      const head = Buffer.alloc(5);
      await handle.read(head, 0, 5, 0);
      if (head.toString("latin1") !== "%PDF-") return INVALID;
    } finally {
      await handle.close();
    }
  } catch {
    return INVALID;
  }

  const pdfinfo = await runProcess(process.env.PDFINFO_BIN || "pdfinfo", [pdfPath], { timeoutMs });
  if (pdfinfo.outcome === "unavailable") return { valid: true, pages: null, hasText: null, textLength: 0 };
  if (pdfinfo.outcome !== "ok") return INVALID;
  const pages = Number(/^Pages:\s+(\d+)/m.exec(pdfinfo.stdout)?.[1] ?? 0);
  if (pages < 1) return INVALID;

  const text = await runProcess(process.env.PDFTOTEXT_BIN || "pdftotext", ["-q", pdfPath, "-"], {
    timeoutMs,
    maxOutput: 1024 * 1024,
  });
  if (text.outcome === "unavailable") return { valid: true, pages, hasText: null, textLength: 0 };
  if (text.outcome !== "ok") return INVALID;
  const textLength = text.stdout.replace(/\s+/g, "").length;
  return { valid: true, pages, hasText: textLength > 0, textLength };
}
