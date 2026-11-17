import { z } from "zod";

const id = z.string().min(1).max(64);

/** POST /api/chat */
export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  /** 이어갈 스레드. 없으면 새 스레드를 만든다. */
  threadId: id.optional(),
  /** 에디터에서 연 경우: 현재 문서. 내용은 서버가 소유자 검사 후 읽는다. */
  documentId: id.optional(),
  /** 프로젝트에서 연 경우: 프로젝트. 설명·키워드는 서버가 소유자 검사 후 읽는다. */
  projectId: id.optional(),
  /** 에디터에서 사용자가 선택한 글 (문서 전체보다 우선하는 컨텍스트) */
  selection: z.string().max(8000).optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** 이미지 원본 약 5MB까지 (base64 길이 기준) */
export const MAX_IMAGE_BASE64_LENGTH = 7_000_000;

/** POST /api/ai/latex — 설명 또는 이미지 중 정확히 하나 */
export const latexRequestSchema = z
  .object({
    description: z.string().trim().min(1).max(1000).optional(),
    image: z
      .object({
        mediaType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
        data: z
          .string()
          .min(16)
          .max(MAX_IMAGE_BASE64_LENGTH)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/, "base64 형식이 아닙니다."),
      })
      .optional(),
  })
  .refine((v) => (v.description === undefined) !== (v.image === undefined), {
    message: "description 또는 image 중 하나만 보내야 합니다.",
  });

/** POST /api/ai/format */
export const formatRequestSchema = z.object({ text: z.string().trim().min(1).max(2000) });

/** POST /api/ai/chart-suggest */
export const chartSuggestRequestSchema = z.object({ datasetId: id });
