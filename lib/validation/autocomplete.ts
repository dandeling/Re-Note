import { z } from "zod";
import { AUTOCOMPLETE_MAX_BEFORE, AUTOCOMPLETE_MAX_HEADING } from "@/lib/editor/autocomplete-text";

/** POST /api/ai/autocomplete */
export const autocompleteRequestSchema = z.object({
  documentId: z.string().min(1).max(64),
  /** 커서 앞 텍스트. 클라이언트가 뒤쪽 약 1,500자만 보낸다 (여유 100자). */
  before: z.string().min(1).max(AUTOCOMPLETE_MAX_BEFORE + 100),
  /** 커서가 속한 절 제목 */
  section: z.string().max(AUTOCOMPLETE_MAX_HEADING).optional(),
  /** 문서 제목 */
  title: z.string().max(AUTOCOMPLETE_MAX_HEADING).optional(),
});
export type AutocompleteRequestBody = z.infer<typeof autocompleteRequestSchema>;
