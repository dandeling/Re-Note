import { notFound } from "next/navigation";
import { DocumentEditor } from "@/components/editor/document-editor";
import { prisma } from "@/lib/db";
import type { DocContent } from "@/lib/editor/content";
import { requireUser } from "@/server/require-user";

export default async function DocumentPage({ params }: PageProps<"/projects/[id]/docs/[docId]">) {
  const { id, docId } = await params;
  const user = await requireUser(`/projects/${id}/docs/${docId}`);
  // 소유자의 문서가 아니면 404 (SPEC 7.6)
  const doc = await prisma.document.findFirst({
    where: { id: docId, projectId: id, deletedAt: null, project: { ownerId: user.id, deletedAt: null } },
  });
  if (!doc) notFound();

  return (
    <main className="flex flex-1 flex-col">
      <DocumentEditor
        projectId={id}
        doc={{
          id: doc.id,
          title: doc.title,
          contentJson: doc.contentJson as unknown as DocContent,
          version: doc.version,
          updatedAt: doc.updatedAt.toISOString(),
        }}
      />
    </main>
  );
}
