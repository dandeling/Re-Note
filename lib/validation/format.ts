import { z } from "zod";
import { formatRulesSchema } from "@/lib/format/rules";

const id = z.string().min(1).max(64);

/** GET /api/format-templates?docId= — docId를 주면 그 문서에 적용된 템플릿 id도 함께 돌려준다. */
export const listFormatTemplatesQuerySchema = z.object({ docId: id.optional() });

/** POST /api/format-templates — id가 있으면 내 템플릿 수정, 없으면 새로 저장 */
export const saveFormatTemplateSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(60),
  rulesJson: formatRulesSchema,
});

export const exportDocumentSchema = z
  .object({
    format: z.enum(["pdf", "docx", "md"]),
    /** true면 파일을 내려보내지 않고 내 PDF 자산으로 저장해 `{ asset }`을 돌려준다(연구 공개의 결과보고서용, PDF만). */
    saveAsAsset: z.boolean().optional(),
  })
  .refine((v) => !v.saveAsAsset || v.format === "pdf", {
    message: "자산으로 저장은 PDF만 할 수 있습니다.",
    path: ["saveAsAsset"],
  });
export type ExportFormat = z.infer<typeof exportDocumentSchema>["format"];
