import { prisma } from "@/lib/db";
import { purgeExpiredTrash } from "@/server/trash";
import type { CreateProjectInput } from "@/lib/validation/project";

export type ProjectStatus = "active" | "archived" | "trash";

export async function listProjects(ownerId: string, status: ProjectStatus = "active") {
  // 휴지통을 볼 때 보관 기간(30일)이 지난 항목을 정리한다.
  if (status === "trash") await purgeExpiredTrash(new Date(), ownerId);
  const where =
    status === "trash"
      ? { ownerId, deletedAt: { not: null } }
      : { ownerId, deletedAt: null, archivedAt: status === "archived" ? { not: null } : null };
  return prisma.project.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
  });
}

export function createProject(ownerId: string, input: CreateProjectInput) {
  return prisma.project.create({ data: { ownerId, ...input } });
}
