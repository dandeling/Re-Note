import { writeFile } from "node:fs/promises";
import path from "node:path";
import { looksLikeHwp, looksLikeHwpx } from "@/lib/conversion/precheck";
import { ConversionError } from "@/lib/conversion/to-pdf";
import { extractHwpStructure } from "@/lib/importer/hwp";
import type { Extracted } from "@/server/jobs/import";
import { renderPreviewPdf } from "@/server/jobs/import-preview";
import type { JobContext, JobWithInput } from "@/server/jobs/process";

/** HWP/HWPX 가져오기: 중간 형식(Markdown/XHTML)을 거쳐 Tiptap JSON으로 매핑. 원본 미리보기 PDF도 만든다. */
export async function extractHwp({ bytes, job, ctx }: { bytes: Uint8Array; job: JobWithInput; ctx: JobContext }): Promise<Extracted> {
  const kind = job.inputAsset.kind === "HWPX" ? "hwpx" : "hwp";
  if (!(kind === "hwp" ? looksLikeHwp(bytes) : looksLikeHwpx(bytes))) throw new ConversionError("CORRUPT");
  const input = path.join(ctx.workDir, `input.${kind}`);
  await writeFile(input, bytes);
  const extraction = await extractHwpStructure({ input, kind, workDir: ctx.workDir, deadline: ctx.deadline });
  return {
    html: extraction.html,
    images: extraction.images,
    notes: ["LAYOUT", "HWP_STRUCTURE", "EQUATIONS", "CHECK_ORIGINAL"],
    previewPdf: await renderPreviewPdf(bytes, kind, ctx),
    engine: extraction.engine,
    attempts: extraction.attempts,
  };
}
