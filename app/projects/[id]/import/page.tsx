import { notFound } from "next/navigation";
import { BrowserImportTool } from "@/components/importer/browser-import-tool";
import { ImportTool } from "@/components/importer/import-tool";
import { prisma } from "@/lib/db";
import { serverConversionEnabled } from "@/lib/features";
import { maxUploadBytes } from "@/lib/files/types";
import { MAX_FILE } from "@/lib/hwp-browser";
import { hwpBrowserText } from "@/lib/hwp-browser/ui-text";
import { messages } from "@/lib/messages";
import { requireUser } from "@/server/require-user";

export const metadata = { title: messages.importer.title };

/**
 * 파일 가져오기 (SPEC 7.5). `?doc=<문서 ID>`이면 그 문서 끝에 붙인다(붙이기 전 스냅샷). `?job=`으로 결과를 다시 연다.
 * 서버 변환을 끈 배포(lib/features.ts)에서는 HWP/HWPX를 브라우저에서 읽어 늘 새 문서로 만든다(`?doc=`·`?job=`은 쓰지 않는다).
 */
export default async function ImportPage({ params, searchParams }: PageProps<"/projects/[id]/import">) {
  const { id } = await params;
  const query = await searchParams;
  const user = await requireUser(`/projects/${id}/import`);
  const project = await prisma.project.findFirst({ where: { id, ownerId: user.id, deletedAt: null }, select: { id: true, title: true } });
  if (!project) notFound();
  const docId = typeof query.doc === "string" ? query.doc : null;
  const target = docId
    ? await prisma.document.findFirst({ where: { id: docId, projectId: project.id, deletedAt: null }, select: { id: true, title: true } })
    : null;
  if (docId && !target) notFound();
  const jobId = typeof query.job === "string" && /^[0-9a-z]{16,64}$/.test(query.job) ? query.job : null;
  const browserOnly = !serverConversionEnabled();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{project.title}</p>
        <h1 className="text-2xl font-bold">{messages.importer.title}</h1>
        <p className="text-muted-foreground">{browserOnly ? hwpBrowserText.importer.intro : messages.importer.intro}</p>
      </header>
      {browserOnly ? (
        <BrowserImportTool projectId={project.id} target={target} maxMb={Math.floor(Math.min(maxUploadBytes(), MAX_FILE) / 1024 / 1024)} />
      ) : (
        <ImportTool
          projectId={project.id}
          target={target}
          maxMb={Math.floor(maxUploadBytes() / 1024 / 1024)}
          initialJobId={jobId}
        />
      )}
    </main>
  );
}
