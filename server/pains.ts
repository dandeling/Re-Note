import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { markdownExcerpt } from "@/lib/markdown";
import { messages } from "@/lib/messages";
import type { CreatePainInput, PainSort, PainStageValue, UpdatePainInput } from "@/lib/validation/pain";
import { ApiError, notFound } from "@/server/api";

/**
 * 고충 게시판 서버 로직 (SPEC 7.1). 페이지와 API가 같이 쓴다.
 *
 * 익명 글 보호 (SPEC 9장 "익명 글 작성자 비노출"):
 * - DB 행을 그대로 내보내지 않는다. 밖으로 나가는 값은 전부 `toSummary`가 필드를 하나씩 골라 만든다.
 * - `authorId`·이메일은 어떤 글에서도 내보내지 않는다. 익명 글은 `author`가 null이다.
 * - `projectId`는 본인에게만 내려준다(같은 프로젝트에 연결된 실명 글과 묶여 신원이 드러나는 것을 막는다).
 * - 익명 글은 공개 연구(`Research`, 작성자 공개)에 연결할 수 없다.
 *
 * 댓글 없음 (docs/decisions.md pains-9): 고충은 한 번에 쓰는 글이다. 다른 사람은 "나도 겪었어요"와 신고만 할 수 있다.
 * DB의 `Comment` 테이블은 남아 있지만(예전 데이터 보존) 여기서는 읽지도 쓰지도 않는다.
 */

export type PublicAuthor = { name: string | null; image: string | null };

export type PainSummary = {
  id: string;
  title: string;
  stage: PainStageValue;
  field: string;
  tags: string[];
  isAnonymous: boolean;
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
  researchId: string | null;
  /** 익명 글이면 null */
  author: PublicAuthor | null;
  /** 보는 사람이 작성자일 때만 true */
  isMine: boolean;
  /** 본인 글일 때만 포함 */
  projectId?: string | null;
  meTooCount: number;
  /** 보는 사람이 "나도 겪었어요"를 눌렀는지 */
  reactedByMe: boolean;
};

export type PainListItem = PainSummary & { excerpt: string };
export type PainDetail = PainSummary & { body: string; resolution: string | null };

const authorSelect = { select: { name: true, image: true } } as const;

function painInclude(viewerId: string | null) {
  return {
    author: authorSelect,
    _count: { select: { reactions: true } },
    // 보는 사람 자신의 반응만 가져온다.
    reactions: { where: { userId: viewerId ?? "" }, select: { id: true }, take: viewerId ? 1 : 0 },
  } satisfies Prisma.PainPostInclude;
}

type PainRow = Prisma.PainPostGetPayload<{ include: ReturnType<typeof painInclude> }>;

function publicAuthor(author: { name: string | null; image: string | null }): PublicAuthor {
  return { name: author.name, image: author.image };
}

function toSummary(row: PainRow, viewerId: string | null): PainSummary {
  const isMine = viewerId !== null && row.authorId === viewerId;
  return {
    id: row.id,
    title: row.title,
    stage: row.stage,
    field: row.field,
    tags: row.tags,
    isAnonymous: row.isAnonymous,
    resolved: row.resolved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    researchId: row.isAnonymous ? null : row.researchId,
    author: row.isAnonymous ? null : publicAuthor(row.author),
    isMine,
    ...(isMine ? { projectId: row.projectId } : {}),
    meTooCount: row._count.reactions,
    reactedByMe: row.reactions.length > 0,
  };
}

function toListItem(row: PainRow, viewerId: string | null): PainListItem {
  return { ...toSummary(row, viewerId), excerpt: markdownExcerpt(row.body) };
}

function toDetail(row: PainRow, viewerId: string | null): PainDetail {
  return { ...toSummary(row, viewerId), body: row.body, resolution: row.resolved ? row.resolution : null };
}

/** 부분 일치 검색(ILIKE, trigram 인덱스 사용). 사용자가 넣은 %, _ 는 와일드카드가 아니라 글자로 취급한다. */
function contains(q: string) {
  return { contains: q.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" } as const;
}

export type ListPainsOptions = {
  sort?: PainSort;
  stage?: PainStageValue;
  field?: string;
  tag?: string;
  /** 제목·본문 검색어 */
  q?: string;
  /** 특정 공개 연구에 연결된 고충만 (연구 상세의 "고충 목록") */
  researchId?: string;
  /** 서버 내부 전용(프로젝트 홈의 "내 고충"). 공개 API 쿼리로 받지 않는다. authorId와 함께 써야 한다. */
  projectId?: string;
  /** 서버 내부 전용. 특정 작성자의 글만. */
  authorId?: string;
  page?: number;
  pageSize?: number;
  /** 보는 사람(로그인 사용자) id. isMine·reactedByMe 계산에 쓴다. */
  viewerId?: string | null;
};

export type PainListResult = {
  pains: PainListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/** 고충 목록. 정렬(최신순/공감순)·단계·분야·태그 필터·검색·페이지네이션. */
export async function listPains(options: ListPainsOptions = {}): Promise<PainListResult> {
  const { sort = "latest", stage, field, tag, q, researchId, projectId, authorId, viewerId = null } = options;
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));

  const where: Prisma.PainPostWhereInput = {
    ...(stage ? { stage } : {}),
    ...(field ? { field: { equals: field, mode: "insensitive" } } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
    // 익명 글은 연구에 연결할 수 없지만, 혹시 남아 있더라도 연구별 목록에는 내보내지 않는다.
    ...(researchId ? { researchId, isAnonymous: false } : {}),
    ...(projectId ? { projectId } : {}),
    ...(authorId ? { authorId } : {}),
    ...(q ? { OR: [{ title: contains(q) }, { body: contains(q) }] } : {}),
  };
  const orderBy: Prisma.PainPostOrderByWithRelationInput[] =
    sort === "popular"
      ? [{ reactions: { _count: "desc" } }, { createdAt: "desc" }, { id: "desc" }]
      : [{ createdAt: "desc" }, { id: "desc" }];

  const [total, rows] = await Promise.all([
    prisma.painPost.count({ where }),
    prisma.painPost.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: painInclude(viewerId),
    }),
  ]);
  return {
    pains: rows.map((row) => toListItem(row, viewerId)),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** 필터 입력 자동완성용: 많이 쓰인 분야 이름 */
export async function listPainFields(limit = 30): Promise<string[]> {
  const rows = await prisma.painPost.groupBy({
    by: ["field"],
    where: { field: { not: "" } },
    _count: { field: true },
    orderBy: { _count: { field: "desc" } },
    take: limit,
  });
  return rows.map((r) => r.field);
}

/** 고충 상세. 없으면 null. */
export async function findPain(id: string, viewerId: string | null): Promise<PainDetail | null> {
  const row = await prisma.painPost.findUnique({ where: { id }, include: painInclude(viewerId) });
  return row ? toDetail(row, viewerId) : null;
}

/** API용: 없으면 404 */
export async function getPain(id: string, viewerId: string | null): Promise<PainDetail> {
  return (await findPain(id, viewerId)) ?? notFound();
}

/** 홈 화면의 "고충 N건" */
export async function countPains(): Promise<number> {
  return prisma.painPost.count();
}

function invalid(message: string): never {
  throw new ApiError("VALIDATION_ERROR", message);
}

/**
 * 연결 대상 검사. 프로젝트·연구 모두 본인 것만 연결할 수 있다.
 * 남의 것과 없는 것을 같은 응답으로 처리해 존재 여부를 드러내지 않는다.
 */
async function assertLinkable(userId: string, link: { projectId: string | null; researchId: string | null; isAnonymous: boolean }) {
  const t = messages.pains.errors;
  if (link.isAnonymous && link.researchId) invalid(t.anonymousResearch);
  if (link.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: link.projectId, ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    if (!project) invalid(t.projectNotLinkable);
  }
  if (link.researchId) {
    const research = await prisma.research.findFirst({
      where: { id: link.researchId, authorId: userId },
      select: { id: true },
    });
    if (!research) invalid(t.researchNotLinkable);
  }
}

export async function createPain(userId: string, input: CreatePainInput): Promise<PainDetail> {
  await assertLinkable(userId, input);
  const row = await prisma.painPost.create({ data: { authorId: userId, ...input }, include: painInclude(userId) });
  return toDetail(row, userId);
}

/** 작성자 본인 글인지 검사. 없으면 404, 남의 글이면 403(공개 글이라 존재를 숨길 이유가 없다). */
async function getOwnPainRow(userId: string, id: string) {
  const row = await prisma.painPost.findUnique({ where: { id } });
  if (!row) notFound();
  if (row.authorId !== userId) throw new ApiError("FORBIDDEN", messages.pains.errors.notAuthor);
  return row;
}

export async function updatePain(userId: string, id: string, input: UpdatePainInput): Promise<PainDetail> {
  const current = await getOwnPainRow(userId, id);
  const { resolved, resolution, ...fields } = input;

  if (fields.projectId !== undefined || fields.researchId !== undefined || fields.isAnonymous !== undefined) {
    await assertLinkable(userId, {
      // 바뀌지 않는 연결은 다시 검사하지 않는다(연결 후 프로젝트가 휴지통에 가도 글 수정은 가능해야 한다).
      projectId: fields.projectId !== undefined && fields.projectId !== current.projectId ? fields.projectId : null,
      researchId:
        fields.researchId !== undefined && fields.researchId !== current.researchId ? fields.researchId : null,
      isAnonymous: false,
    });
    const nextAnonymous = fields.isAnonymous ?? current.isAnonymous;
    const nextResearchId = fields.researchId !== undefined ? fields.researchId : current.researchId;
    if (nextAnonymous && nextResearchId) invalid(messages.pains.errors.anonymousResearch);
  }

  // 해결됨 처리 (SPEC 7.1): 해결됨으로 바꿀 때는 해결 방법이 꼭 있어야 한다.
  const resolutionData: Prisma.PainPostUpdateInput = {};
  const nextResolved = resolved ?? current.resolved;
  if (resolved === false) {
    resolutionData.resolved = false;
    resolutionData.resolution = null;
  } else if (resolved === true || resolution !== undefined) {
    if (!nextResolved) invalid(messages.pains.errors.resolutionWithoutResolved);
    const text = resolution ?? current.resolution ?? "";
    if (!text) invalid(messages.pains.errors.resolutionRequired);
    resolutionData.resolved = true;
    resolutionData.resolution = text;
  }

  const { projectId, researchId, ...scalars } = fields;
  const row = await prisma.painPost.update({
    where: { id },
    data: {
      ...scalars,
      ...resolutionData,
      ...(projectId === undefined ? {} : { project: projectId ? { connect: { id: projectId } } : { disconnect: true } }),
      ...(researchId === undefined
        ? {}
        : { research: researchId ? { connect: { id: researchId } } : { disconnect: true } }),
    },
    include: painInclude(userId),
  });
  return toDetail(row, userId);
}

export async function deletePain(userId: string, id: string) {
  await getOwnPainRow(userId, id);
  await prisma.painPost.delete({ where: { id } });
}

async function getPostForInteraction(id: string) {
  const post = await prisma.painPost.findUnique({ where: { id }, select: { id: true } });
  return post ?? notFound();
}

function isUniqueViolation(err: unknown) {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/** "나도 겪었어요" 토글. (painPostId, userId)는 유일하다. */
export async function toggleReaction(userId: string, painPostId: string) {
  await getPostForInteraction(painPostId);
  const removed = await prisma.reaction.deleteMany({ where: { painPostId, userId } });
  let reacted = false;
  if (removed.count === 0) {
    try {
      await prisma.reaction.create({ data: { painPostId, userId } });
    } catch (err) {
      // 동시에 두 번 눌러 이미 만들어진 경우: 눌린 상태로 본다.
      if (!isUniqueViolation(err)) throw err;
    }
    reacted = true;
  }
  const meTooCount = await prisma.reaction.count({ where: { painPostId } });
  return { reacted, meTooCount };
}

/** 신고: 관리자 검토용 플래그만 저장한다. 같은 사람이 같은 글을 다시 신고하면 사유만 갱신한다. */
export async function reportPain(userId: string, painPostId: string, reason: string) {
  await getPostForInteraction(painPostId);
  const existing = await prisma.painReport.findFirst({ where: { painPostId, reporterId: userId }, select: { id: true } });
  if (existing) {
    if (reason) await prisma.painReport.update({ where: { id: existing.id }, data: { reason } });
    return;
  }
  await prisma.painReport.create({ data: { painPostId, reporterId: userId, reason } });
}

/** 작성 화면의 "연결할 프로젝트/연구" 선택지 (본인 것만) */
export async function listLinkTargets(userId: string) {
  const [projects, researches] = await Promise.all([
    prisma.project.findMany({
      where: { ownerId: userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true },
      take: 200,
    }),
    prisma.research.findMany({
      where: { authorId: userId },
      orderBy: { publishedAt: "desc" },
      select: { id: true, title: true },
      take: 200,
    }),
  ]);
  return { projects, researches };
}

export const PAIN_RATE_LIMITS = {
  write: { limit: 20, windowMs: 10 * 60_000 },
  reaction: { limit: 60, windowMs: 10 * 60_000 },
  report: { limit: 10, windowMs: 60 * 60_000 },
} as const;
