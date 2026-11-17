import { z } from "zod";

const filename = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((name) => !/[\\/\u0000-\u001f]/.test(name), { message: "파일 이름에 쓸 수 없는 문자가 있습니다." });
const id = z.string().min(1).max(64);

export const uploadUrlSchema = z.object({
  filename,
  size: z.number().int().min(1),
  projectId: id.optional(),
});

export const completeUploadSchema = z.object({
  key: z.string().min(1).max(512),
  filename,
  projectId: id.optional(),
});

export const assetFilenameSchema = filename;
