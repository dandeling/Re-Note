import type { z } from "zod";
import { prisma } from "@/lib/db";
import { EMPTY_DOC } from "@/lib/editor/content";
import type { Prisma } from "@/lib/generated/prisma/client";
import { messages } from "@/lib/messages";
import type { createDocumentSchema, updateDocumentSchema } from "@/lib/validation/document";
import { getOwnedDocument, getOwnedProject } from "@/server/access";
import { ApiError } from "@/server/api";
import { maybeAutoSnapshot } from "@/server/snapshots";

export async function createDocument(userId: string, projectId: string, input: z.infer<typeof createDocumentSchema>) {
  await getOwnedProject(userId, projectId);
  return prisma.document.create({
    data: {
      projectId,
      title: input.title ?? messages.docs.untitled,
      contentJson: (input.contentJson ?? EMPTY_DOC) as Prisma.InputJsonValue,
    },
  });
}

export function listDocuments(projectId: string) {
  return prisma.document.findMany({
    where: { projectId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true, version: true },
  });
}

/**
 * 문서 수정. 내용 변경은 낙관적 잠금으로 보호한다 (SPEC 7.5).
 * baseVersion이 서버 버전과 다르면 409 CONFLICT와 함께 서버 버전을 알려준다.
 */
export async function updateDocument(userId: string, documentId: string, input: z.infer<typeof updateDocumentSchema>) {
  const current = await getOwnedDocument(userId, documentId);
  const data: Prisma.DocumentUpdateManyMutationInput = {};
  if (input.title !== undefined) data.title = input.title;

  if (input.formatTemplateId !== undefined) {
    if (input.formatTemplateId !== null) {
      const template = await prisma.formatTemplate.findFirst({
        where: { id: input.formatTemplateId, OR: [{ isPreset: true }, { ownerId: userId }] },
        select: { id: true },
      });
      if (!template) throw new ApiError("NOT_FOUND");
    }
    await prisma.document.update({ where: { id: documentId }, data: { formatTemplateId: input.formatTemplateId } });
  }

  if (input.contentJson === undefined) {
    if (Object.keys(data).length > 0) await prisma.document.updateMany({ where: { id: documentId }, data });
    return prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  }

  // version이 baseVersion과 같을 때만 갱신한다 (원자적 비교·교환).
  const result = await prisma.document.updateMany({
    where: { id: documentId, version: input.baseVersion },
    data: { ...data, contentJson: input.contentJson as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  if (result.count === 0) {
    const latest = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    throw new ApiError("CONFLICT", messages.docs.conflict, {
      serverVersion: latest.version,
      serverUpdatedAt: latest.updatedAt.toISOString(),
      yourBaseVersion: input.baseVersion ?? current.version,
    });
  }
  const saved = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  await maybeAutoSnapshot(saved);
  return saved;
}

export async function trashDocument(userId: string, documentId: string) {
  await getOwnedDocument(userId, documentId);
  await prisma.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
}
