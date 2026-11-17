import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sofficeToPdf } from "@/lib/conversion/engines";
import { convertToPdf } from "@/lib/conversion/to-pdf";
import { log } from "@/lib/log";
import type { JobContext } from "@/server/jobs/process";

/** 미리보기에 쓸 수 있는 최대 시간. 본 작업(추출) 시간을 남겨 둔다. */
const PREVIEW_BUDGET_MS = 45_000;
const RESERVE_MS = 15_000;

/**
 * 원본 미리보기용 PDF (가져오기 결과 화면에 원본과 나란히 보여 준다).
 * 브라우저가 바로 보여 주지 못하는 DOCX·HWP·HWPX만 만든다. 실패해도 가져오기는 계속한다(null).
 */
export async function renderPreviewPdf(bytes: Uint8Array, kind: "docx" | "hwp" | "hwpx", ctx: JobContext) {
  const budget = Math.min(PREVIEW_BUDGET_MS, ctx.deadline - Date.now() - RESERVE_MS);
  if (budget < 3000) return null;
  const started = Date.now();
  try {
    const dir = path.join(ctx.workDir, "preview");
    await mkdir(dir, { recursive: true });
    const input = path.join(dir, `original.${kind}`);
    await writeFile(input, bytes);
    const pdfPath =
      kind === "docx"
        ? await sofficeToPdf(input, dir, budget)
        : (await convertToPdf({ input, kind, workDir: dir, deadline: Date.now() + budget })).pdfPath;
    return { filename: "original-preview.pdf", bytes: new Uint8Array(await readFile(pdfPath)) };
  } catch (err) {
    log.warn("import.preview_failed", { kind, ms: Date.now() - started, reason: String(err).slice(0, 300) });
    return null;
  }
}
