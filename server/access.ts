import { prisma } from "@/lib/db";
import { notFound } from "@/server/api";

/**
 * 소유자 권한 검사 (SPEC 7.6).
 * 다른 사용자의 자원은 존재 여부를 숨기기 위해 403이 아니라 404로 응답한다.
 */
export async function getOwnedProject(userId: string, projectId: string, opts: { includeDeleted?: boolean } = {}) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: userId, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
  });
  if (!project) notFound();
  return project;
}

export async function getOwnedDocument(userId: string, documentId: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null, project: { ownerId: userId, deletedAt: null } },
  });
  if (!doc) notFound();
  return doc;
}
