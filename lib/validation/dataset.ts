import { z } from "zod";
import { MAX_CSV_ROWS } from "@/lib/csv/parse";

const id = z.string().min(1).max(64);

export const createDatasetSchema = z.object({
  /** 업로드가 끝난 CSV 자산 (POST /api/assets/complete의 결과) */
  assetId: id,
  /** 자산이 프로젝트에 속해 있지 않을 때만 필요 */
  projectId: id.optional(),
  name: z.string().trim().min(1).max(200).optional(),
});

export const listDatasetsSchema = z.object({ projectId: id });

export const DEFAULT_PREVIEW_ROWS = 50;

export const previewDatasetSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_CSV_ROWS).default(DEFAULT_PREVIEW_ROWS),
});
