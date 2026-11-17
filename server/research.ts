import { cache } from "react";
import { prisma } from "@/lib/db";
import { indexEmbedding } from "@/lib/search";
import type { CreateResearchInput } from "@/lib/validation/research";
import { ApiError } from "@/server/api";
import { getOwnedProject } from "@/server/access";
import { listPains } from "@/server/pains";
import { messages } from "@/lib/messages";

/**
 * 연구 공개·조회 (SPEC 7.2).
 * 공개된 연구는 누구나 볼 수 있지만, 응답에는 작성자 정보와 고충 작성자 정보를 넣지 않는다.
 */

/** 본인 프로젝트를 연구로 공개한다. 남의 프로젝트·휴지통의 프로젝트는 404. */
export async function createResearch(userId: string, input: CreateResearchInput) {
  const project = await getOwnedProject(userId, input.projectId);

  let reportAssetId: string | null = null;
  if (input.reportAssetId) {
    // 본인 소유(직접 또는 본인 프로젝트)의 삭제되지 않은 PDF만 연결한다. 그 외는 존재를 숨기고 400.
    const asset = await prisma.asset.findFirst({
      where: {
        id: input.reportAssetId,
        kind: "PDF",
        deletedAt: null,
        OR: [{ ownerId: userId }, { project: { ownerId: userId, deletedAt: null } }],
      },
      select: { id: true },
    });
    if (!asset) throw new ApiError("VALIDATION_ERROR", messages.research.errors.reportInvalid);
    reportAssetId = asset.id;
  }

  const research = await prisma.research.create({
    data: {
      projectId: project.id,
      authorId: userId,
      title: input.title,
      summary: input.summary,
      field: input.field,
      keywords: [...new Set(input.keywords)],
      limitations: input.limitations,
      reportAssetId,
    },
    select: publicResearchSelect,
  });
  // 임베딩 제공자가 설정된 경우에만 동작하고, 실패해도 공개는 성공한다(trigram 색인은 DB 트리거가 관리).
  await indexEmbedding("research", research.id);
  return toPublicResearch(research);
}

const publicResearchSelect = {
  id: true,
  title: true,
  summary: true,
  field: true,
  keywords: true,
  limitations: true,
  publishedAt: true,
  reportAsset: { select: { id: true, filename: true, size: true, deletedAt: true } },
} as const;

type ResearchRow = {
  id: string;
  title: string;
  summary: string;
  field: string;
  keywords: string[];
  limitations: string;
  publishedAt: Date;
  reportAsset: { id: string; filename: string; size: number; deletedAt: Date | null } | null;
};

function toPublicResearch(r: ResearchRow) {
  const report = r.reportAsset && !r.reportAsset.deletedAt ? r.reportAsset : null;
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    field: r.field,
    keywords: r.keywords,
    limitations: r.limitations,
    publishedAt: r.publishedAt,
    report: report ? { assetId: report.id, filename: report.filename, size: report.size } : null,
  };
}

export type PublicResearch = ReturnType<typeof toPublicResearch>;

/** 연구 상세에 보여 줄 연결된 고충 최대 개수 */
export const RESEARCH_PAINS_LIMIT = 50;

export type LinkedPain = {
  id: string;
  title: string;
  stage: string;
  resolved: boolean;
  createdAt: Date;
  path: string;
};

/**
 * 공개된 연구 하나와 연결된 고충 목록. 없으면 null.
 * 고충은 `listPains({ researchId })`로 가져와 제목·단계·해결 여부·링크만 돌려준다.
 * 익명 글은 연구별 목록에서 빠진다(연구 작성자와 묶여 신원이 드러나지 않게, decisions pains-5·harden-2).
 */
export const getPublicResearch = cache(async function getPublicResearch(
  id: string,
): Promise<(PublicResearch & { pains: LinkedPain[] }) | null> {
  const research = await prisma.research.findUnique({ where: { id }, select: publicResearchSelect });
  if (!research) return null;
  const { pains } = await listPains({ researchId: id, pageSize: RESEARCH_PAINS_LIMIT });
  return {
    ...toPublicResearch(research),
    pains: pains.map((p) => ({
      id: p.id,
      title: p.title,
      stage: p.stage,
      resolved: p.resolved,
      createdAt: p.createdAt,
      path: `/pains/${p.id}`,
    })),
  };
});

/** 프로젝트 홈에서 이 프로젝트로 공개한 연구 목록 (소유자 전용 화면에서만 사용) */
export async function listProjectResearch(projectId: string) {
  return prisma.research.findMany({
    where: { projectId },
    orderBy: { publishedAt: "desc" },
    select: { id: true, title: true, publishedAt: true },
  });
}
