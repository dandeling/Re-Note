import { PainForm } from "@/components/pains/pain-form";
import { messages } from "@/lib/messages";
import { listLinkTargets } from "@/server/pains";
import { requireUser } from "@/server/require-user";

export const metadata = { title: messages.pains.newTitle };

/** 고충 작성. 로그인 필요. `?projectId=`로 연결할 프로젝트를 미리 고를 수 있다. */
export default async function NewPainPage({ searchParams }: PageProps<"/pains/new">) {
  const { projectId } = await searchParams;
  const defaultProjectId = typeof projectId === "string" ? projectId : undefined;
  const user = await requireUser(
    defaultProjectId ? `/pains/new?projectId=${encodeURIComponent(defaultProjectId)}` : "/pains/new",
  );
  const { projects, researches } = await listLinkTargets(user.id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">{messages.pains.newTitle}</h1>
      <PainForm projects={projects} researches={researches} defaultProjectId={defaultProjectId} />
    </main>
  );
}
