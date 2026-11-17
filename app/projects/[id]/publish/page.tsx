import Link from "next/link";
import { notFound } from "next/navigation";
import { PublishResearchForm } from "@/components/research/publish-form";
import { prisma } from "@/lib/db";
import { messages } from "@/lib/messages";
import { requireUser } from "@/server/require-user";

/** 프로젝트 홈 → "연구 공개하기" (SPEC 7.2 공개 흐름). 본인 프로젝트만. */
export default async function PublishResearchPage({ params }: PageProps<"/projects/[id]/publish">) {
  const t = messages.research;
  const { id } = await params;
  const user = await requireUser(`/projects/${id}/publish`);
  const project = await prisma.project.findFirst({ where: { id, ownerId: user.id, deletedAt: null } });
  if (!project) notFound();
  // 결과보고서로 PDF 내보내기할 수 있는 이 프로젝트의 문서 (휴지통 제외)
  const documents = await prisma.document.findMany({
    where: { projectId: project.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true },
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <Link href={`/projects/${project.id}`} className="text-sm text-muted-foreground hover:underline">
          {project.title}
        </Link>
        <h1 className="text-2xl font-bold">{t.publishHeading}</h1>
        <p className="text-muted-foreground">{t.publishIntro}</p>
      </header>
      <PublishResearchForm
        initial={{
          projectId: project.id,
          title: project.title,
          summary: project.description,
          field: project.field,
          keywords: project.keywords,
        }}
        documents={documents}
      />
    </main>
  );
}
