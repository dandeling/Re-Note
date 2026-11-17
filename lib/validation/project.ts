import { z } from "zod";

const keyword = z.string().trim().min(1).max(50);

export const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(""),
  field: z.string().trim().max(100).default(""),
  keywords: z.array(keyword).max(20).default([]),
});

export const updateProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000),
    field: z.string().trim().max(100),
    keywords: z.array(keyword).max(20),
    archived: z.boolean(),
    restore: z.literal(true),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "변경할 값이 없습니다." });

export const listProjectsQuerySchema = z.object({
  status: z.enum(["active", "archived", "trash"]).default("active"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/** "a, b  c" 같은 입력을 키워드 배열로 바꾼다. */
export function parseKeywords(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[,\n]/)) {
    const k = part.trim();
    if (k) seen.add(k);
  }
  return [...seen];
}
