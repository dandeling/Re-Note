import { z } from "zod";
import { docContentSchema } from "@/lib/editor/content";

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  contentJson: docContentSchema.optional(),
});

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    contentJson: docContentSchema.optional(),
    /** 낙관적 잠금: 클라이언트가 마지막으로 본 버전. 내용을 바꿀 때는 필수 */
    baseVersion: z.number().int().min(1).optional(),
    formatTemplateId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.contentJson !== undefined || v.formatTemplateId !== undefined, {
    message: "변경할 값이 없습니다.",
  })
  .refine((v) => v.contentJson === undefined || v.baseVersion !== undefined, {
    message: "내용을 저장하려면 baseVersion이 필요합니다.",
    path: ["baseVersion"],
  });
