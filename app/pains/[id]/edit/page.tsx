import { notFound } from "next/navigation";
import { PainForm } from "@/components/pains/pain-form";
import { messages } from "@/lib/messages";
import { findPain, listLinkTargets } from "@/server/pains";
import { requireUser } from "@/server/require-user";

export const metadata = { title: messages.pains.editTitle };

/** 고충 수정. 작성자만 들어올 수 있다(남의 글이면 404 화면). */
export default async function EditPainPage({ params }: PageProps<"/pains/[id]/edit">) {
  const { id } = await params;
  const user = await requireUser(`/pains/${id}/edit`);
  const found = await findPain(id, user.id);
  if (!found || !found.pain.isMine) notFound();
  const { pain } = found;
  const { projects, researches } = await listLinkTargets(user.id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">{messages.pains.editTitle}</h1>
      <PainForm
        projects={projects}
        researches={researches}
        initial={{
          id: pain.id,
          title: pain.title,
          body: pain.body,
          stage: pain.stage,
          field: pain.field,
          tags: pain.tags,
          projectId: pain.projectId ?? null,
          researchId: pain.researchId,
          isAnonymous: pain.isAnonymous,
        }}
      />
    </main>
  );
}
