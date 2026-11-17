import Link from "next/link";
import { PainList } from "@/components/pains/pain-list";
import { Button } from "@/components/ui/button";
import { messages } from "@/lib/messages";
import { listPains } from "@/server/pains";

/** 프로젝트 홈의 "내 고충" 섹션: 이 프로젝트에 연결한 내 고충 목록 (SPEC 5장 /projects/[id]). */
export async function ProjectPains({ projectId, ownerId }: { projectId: string; ownerId: string }) {
  const t = messages.pains.project;
  const { pains } = await listPains({ projectId, authorId: ownerId, viewerId: ownerId, pageSize: 50 });

  return (
    <section aria-labelledby="project-pains-heading" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 id="project-pains-heading" className="text-lg font-semibold">
          {t.heading}
        </h2>
        <Button asChild size="sm" variant="outline">
          <Link href={`/pains/new?projectId=${encodeURIComponent(projectId)}`}>{t.new}</Link>
        </Button>
      </div>
      {pains.length === 0 ? <p className="text-muted-foreground">{t.empty}</p> : <PainList items={pains} headingLevel={3} />}
    </section>
  );
}
