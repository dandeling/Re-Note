import { z } from "zod";

const keyword = z.string().trim().min(1).max(50);

/** POST /api/research: 프로젝트를 연구로 공개 (SPEC 7.2 공개 흐름) */
export const createResearchSchema = z.object({
  projectId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(5000),
  field: z.string().trim().max(100).default(""),
  keywords: z.array(keyword).min(1).max(20),
  limitations: z.string().trim().max(5000).default(""),
  /** 결과보고서 PDF 자산 ID (선택). 본인 소유 PDF만 연결할 수 있다. */
  reportAssetId: z.string().trim().min(1).max(100).nullish(),
});

export type CreateResearchInput = z.infer<typeof createResearchSchema>;
