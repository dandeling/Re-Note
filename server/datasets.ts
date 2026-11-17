import type { z } from "zod";
import { CsvError, parseCsv, type ColumnInfo } from "@/lib/csv/parse";
import { prisma } from "@/lib/db";
import type { Dataset } from "@/lib/generated/prisma/client";
import { messages } from "@/lib/messages";
import type { createDatasetSchema } from "@/lib/validation/dataset";
import { getOwnedProject } from "@/server/access";
import { ApiError, notFound } from "@/server/api";
import { getOwnedAsset, readAsset } from "@/server/assets";

export type DatasetSummary = {
  id: string;
  projectId: string;
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
  createdAt: string;
};

export type DatasetPreview = {
  dataset: DatasetSummary;
  encoding: "utf-8" | "euc-kr";
  columns: ColumnInfo[];
  rows: string[][];
  rowCount: number;
  truncated: boolean;
  warnings: string[];
};

export function toSummary(d: Dataset): DatasetSummary {
  return {
    id: d.id,
    projectId: d.projectId,
    name: d.name,
    columns: d.columnsJson as unknown as ColumnInfo[],
    rowCount: d.rowCount,
    createdAt: d.createdAt.toISOString(),
  };
}

function parseOrThrow(bytes: Uint8Array) {
  try {
    return parseCsv(bytes);
  } catch (err) {
    if (err instanceof CsvError) throw new ApiError("VALIDATION_ERROR", err.message);
    throw err;
  }
}

/** CSV 자산을 읽어 열 정보를 추론하고 Dataset으로 저장한다 (SPEC 7.3 (e)). */
export async function createDataset(userId: string, input: z.infer<typeof createDatasetSchema>) {
  const asset = await getOwnedAsset(userId, input.assetId);
  if (asset.kind !== "CSV") throw new ApiError("UNSUPPORTED_FILE", messages.data.onlyCsv);
  if (input.projectId && asset.projectId && input.projectId !== asset.projectId) notFound();
  const projectId = asset.projectId ?? input.projectId;
  if (!projectId) throw new ApiError("VALIDATION_ERROR", messages.data.projectRequired);
  await getOwnedProject(userId, projectId);

  const parsed = parseOrThrow(await readAsset(asset));
  if (parsed.rowCount === 0) throw new ApiError("VALIDATION_ERROR", messages.data.noRows);
  const dataset = await prisma.dataset.create({
    data: {
      projectId,
      assetId: asset.id,
      name: input.name ?? asset.filename.replace(/\.csv$/i, ""),
      columnsJson: parsed.columns,
      rowCount: parsed.rowCount,
    },
  });
  return { dataset, encoding: parsed.encoding, warnings: parsed.warnings };
}

/** 소유자 검사. 남의 데이터셋·휴지통 프로젝트의 데이터셋은 404. */
export async function getOwnedDataset(userId: string, datasetId: string) {
  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, project: { ownerId: userId, deletedAt: null }, asset: { deletedAt: null } },
    include: { asset: true },
  });
  if (!dataset) notFound();
  return dataset;
}

export async function listDatasets(userId: string, projectId: string) {
  await getOwnedProject(userId, projectId);
  return listProjectDatasets(projectId);
}

/** 권한 검사를 이미 마친 호출자용 */
export async function listProjectDatasets(projectId: string) {
  const rows = await prisma.dataset.findMany({
    where: { projectId, asset: { deletedAt: null } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSummary);
}

/** 원본 CSV를 다시 읽어 앞에서부터 limit개 행을 돌려준다. 행은 DB에 저장하지 않는다. */
export async function previewDataset(userId: string, datasetId: string, limit: number): Promise<DatasetPreview> {
  const dataset = await getOwnedDataset(userId, datasetId);
  const parsed = parseOrThrow(await readAsset(dataset.asset));
  return {
    dataset: toSummary(dataset),
    encoding: parsed.encoding,
    columns: parsed.columns,
    rows: parsed.rows.slice(0, limit),
    rowCount: parsed.rowCount,
    truncated: parsed.rowCount > limit,
    warnings: parsed.warnings,
  };
}
