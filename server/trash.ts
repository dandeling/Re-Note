import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getOwnedProject } from "@/server/access";
import { notFound } from "@/server/api";

export const TRASH_RETENTION_DAYS = 30;

/**
 * 프로젝트를 휴지통으로 옮긴다. 하위 문서·자산도 같은 시각으로 함께 표시한다 (SPEC 7.6).
 * 이미 개별 삭제된 문서·자산은 건드리지 않아, 복구 시 함께 되살아나지 않는다.
 */
export async function trashProject(userId: string, projectId: string) {
  await getOwnedProject(userId, projectId);
  const deletedAt = new Date();
  await prisma.$transaction([
    prisma.project.update({ where: { id: projectId }, data: { deletedAt } }),
    prisma.document.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt } }),
    prisma.asset.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt } }),
  ]);
  return deletedAt;
}

/** 휴지통의 프로젝트와, 그때 함께 옮겨진 문서·자산을 복구한다. */
export async function restoreProject(userId: string, projectId: string) {
  const project = await getOwnedProject(userId, projectId, { includeDeleted: true });
  const deletedAt = project.deletedAt;
  if (!deletedAt) return project;
  if (isExpired(deletedAt)) notFound();
  const [restored] = await prisma.$transaction([
    prisma.project.update({ where: { id: projectId }, data: { deletedAt: null } }),
    prisma.document.updateMany({ where: { projectId, deletedAt }, data: { deletedAt: null } }),
    prisma.asset.updateMany({ where: { projectId, deletedAt }, data: { deletedAt: null } }),
  ]);
  return restored;
}

function cutoff(now = new Date()) {
  return new Date(now.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function isExpired(deletedAt: Date, now = new Date()) {
  return deletedAt < cutoff(now);
}

/** 영구 삭제 예정일 */
export function purgeDate(deletedAt: Date) {
  return new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * 휴지통에 30일 넘게 있던 프로젝트·문서·자산을 영구 삭제한다.
 * 자산의 스토리지 객체도 함께 지운다 (프로젝트 삭제로 연쇄 삭제되는 자산 포함).
 */
export async function purgeExpiredTrash(now = new Date(), ownerId?: string) {
  const before = cutoff(now);
  const doomed = await prisma.asset.findMany({
    where: {
      ...(ownerId ? { ownerId } : {}),
      OR: [{ deletedAt: { lt: before } }, { project: { deletedAt: { lt: before } } }],
    },
    select: { storageKey: true },
  });
  const [assets, documents, projects] = await prisma.$transaction([
    prisma.asset.deleteMany({ where: { deletedAt: { lt: before }, ...(ownerId ? { ownerId } : {}) } }),
    prisma.document.deleteMany({
      where: { deletedAt: { lt: before }, ...(ownerId ? { project: { ownerId } } : {}) },
    }),
    prisma.project.deleteMany({ where: { deletedAt: { lt: before }, ...(ownerId ? { ownerId } : {}) } }),
  ]);
  const storage = getStorage();
  await Promise.all(doomed.map((asset) => storage.delete(asset.storageKey).catch(() => undefined)));
  return { projects: projects.count, documents: documents.count, assets: assets.count };
}
