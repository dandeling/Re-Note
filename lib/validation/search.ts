import { z } from "zod";

/** GET /api/search 쿼리 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  kind: z.enum(["research", "pain"]).optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
