import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { looksLikePdf } from "@/lib/conversion/precheck";
import { ConversionError } from "@/lib/conversion/to-pdf";
import { extractPdfStructure } from "@/lib/importer/pdf";
import type { NoteCode } from "@/lib/importer/notes";
import type { Extracted } from "@/server/jobs/import";
import type { JobContext, JobWithInput } from "@/server/jobs/process";

/**
 * PDF 가져오기: 텍스트·제목 구조·표(추정)·그림을 추출한다.
 * 스캔 PDF(글자 없음)는 문서를 만들지 않고 원본을 프로젝트 첨부 자산으로만 남긴다 (SPEC 7.5).
 */
export async function extractPdf({ bytes, ctx }: { bytes: Uint8Array; job: JobWithInput; ctx: JobContext }): Promise<Extracted> {
  if (!looksLikePdf(bytes)) throw new ConversionError("CORRUPT");
  const dir = path.join(ctx.workDir, "pdf");
  await mkdir(dir, { recursive: true });
  const input = path.join(dir, "input.pdf");
  await writeFile(input, bytes);
  const pdf = await extractPdfStructure(input, dir, ctx.deadline);
  if (pdf.scanned) return { html: "", notes: ["PDF_SCANNED"], attachOnly: true };
  const notes: NoteCode[] = ["LAYOUT", "PDF_STRUCTURE"];
  if (pdf.tables > 0) notes.push("PDF_TABLES");
  notes.push("CHECK_ORIGINAL");
  return { html: pdf.html, images: pdf.images, notes };
}
