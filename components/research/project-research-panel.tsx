import Link from "next/link";
import { Button } from "@/components/ui/button";
import { messages } from "@/lib/messages";
import { listProjectResearch } from "@/server/research";

/** 프로젝트 홈의 "연구 공개하기" 버튼과 이 프로젝트로 공개한 연구 목록 (소유자 화면 전용) */
export async function ProjectResearchPanel({ projectId }: { projectId: string }) {
  const t = messages.research;
  const published = await listProjectResearch(projectId);
  return (
    <section aria-labelledby="project-research-heading" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 id="project-research-heading" className="text-lg font-semibold">
          {t.published}
        </h2>
        <Button asChild size="sm">
          <Link href={`/projects/${projectId}/publish`}>{t.publish}</Link>
        </Button>
      </div>
      {published.length === 0 ? (
        <p className="text-muted-foreground">{t.noPublished}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {published.map((r) => (
            <li key={r.id} className="px-4 py-2.5">
              <Link href={`/research/${r.id}`} className="font-medium hover:underline">
                {r.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
