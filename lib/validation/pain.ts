import { z } from "zod";

export const PAIN_STAGES = ["TOPIC", "DESIGN", "EXPERIMENT", "ANALYSIS", "REPORT", "OTHER"] as const;
export type PainStageValue = (typeof PAIN_STAGES)[number];

export const PAIN_SORTS = ["latest", "popular"] as const;
export type PainSort = (typeof PAIN_SORTS)[number];

export const PAIN_LIMITS = {
  title: 200,
  body: 20000,
  field: 100,
  tag: 30,
  tags: 10,
  resolution: 5000,
  reason: 1000,
};

/** "#통계" → "통계" */
export function normalizeTag(raw: string) {
  return raw.trim().replace(/^#+/, "").trim();
}

const tag = z.string().transform(normalizeTag).pipe(z.string().min(1).max(PAIN_LIMITS.tag));
const tags = z
  .array(tag)
  .max(PAIN_LIMITS.tags)
  .transform((list) => [...new Set(list)]);
const linkId = z.string().trim().min(1).max(64).nullable();

const fields = {
  title: z.string().trim().min(1).max(PAIN_LIMITS.title),
  body: z.string().trim().min(1).max(PAIN_LIMITS.body),
  stage: z.enum(PAIN_STAGES),
  field: z.string().trim().max(PAIN_LIMITS.field),
  tags,
  researchId: linkId,
  projectId: linkId,
  isAnonymous: z.boolean(),
};

export const createPainSchema = z.object({
  title: fields.title,
  body: fields.body,
  stage: fields.stage.default("OTHER"),
  field: fields.field.default(""),
  tags: fields.tags.default([]),
  researchId: fields.researchId.default(null),
  projectId: fields.projectId.default(null),
  isAnonymous: fields.isAnonymous.default(false),
});

export const updatePainSchema = z
  .object({
    ...fields,
    resolved: z.boolean(),
    resolution: z.string().trim().max(PAIN_LIMITS.resolution),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "변경할 값이 없습니다." });

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
/** 빈 문자열(비워 둔 필터)은 "없음"으로 본다. */
const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const listPainsQuerySchema = z.object({
  sort: z.preprocess(blankToUndefined, z.enum(PAIN_SORTS).default("latest")),
  stage: z.preprocess(blankToUndefined, z.enum(PAIN_STAGES).optional()),
  field: optionalText(PAIN_LIMITS.field),
  tag: z.preprocess(
    (v) => (typeof v === "string" ? normalizeTag(v) || undefined : v),
    z.string().max(PAIN_LIMITS.tag).optional(),
  ),
  q: optionalText(200),
  researchId: optionalText(64),
  page: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(100000).default(1)),
  pageSize: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(50).default(20)),
});

export const createReportSchema = z.object({ reason: z.string().trim().max(PAIN_LIMITS.reason).default("") });

export type CreatePainInput = z.infer<typeof createPainSchema>;
export type UpdatePainInput = z.infer<typeof updatePainSchema>;
export type ListPainsQuery = z.infer<typeof listPainsQuerySchema>;

/** "통계, #설문  " 같은 입력을 태그 배열로 바꾼다. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[,\n]/)) {
    const t = normalizeTag(part);
    if (t) seen.add(t);
  }
  return [...seen];
}
