import Link from "next/link";
import { notFound } from "next/navigation";
import { PainList } from "@/components/pains/pain-list";
import { ReportViewer } from "@/components/research/report-viewer";
import { ResearchCard } from "@/components/research/research-card";
import { Badge } from "@/components/ui/badge";
import { messages } from "@/lib/messages";
import { findSimilarResearch } from "@/lib/search";
import { listPains } from "@/server/pains";
import { getPublicResearch, RESEARCH_PAINS_LIMIT } from "@/server/research";
import { getCurrentUser } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/research/[id]">) {
  const research = await getPublicResearch((await params).id);
  return { title: research?.title ?? messages.common.notFoundTitle };
}

/** 연구 상세 (SPEC 7.2): 요약 / 한계 / 연결된 고충 / 결과보고서를 한 화면에. 비로그인도 열람 가능. */
export default async function ResearchPage({ params }: PageProps<"/research/[id]">) {
  const t = messages.research;
  const { id } = await params;
  const research = await getPublicResearch(id);
  if (!research) notFound();
  const viewer = await getCurrentUser();
  const [pains, similar] = await Promise.all([
    listPains({ researchId: research.id, viewerId: viewer?.id ?? null, pageSize: RESEARCH_PAINS_LIMIT }),
    findSimilarResearch(research),
  ]);
  const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <Link href="/explore" className="text-sm text-muted-foreground hover:underline">
          {t.backToExplore}
        </Link>
        <h1 className="text-2xl font-bold">{research.title}</h1>
        <p className="text-sm text-muted-foreground">
          {t.publishedAt.replace("{date}", dateFormat.format(research.publishedAt))}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {research.field ? <Badge variant="secondary">{research.field}</Badge> : null}
          {research.keywords.map((k) => (
            <Badge key={k} variant="secondary">
              {k}
            </Badge>
          ))}
        </div>
      </header>

      <div className="grid gap-8 md:grid-cols-2">
        <section aria-labelledby="research-summary-heading" className="flex flex-col gap-2">
          <h2 id="research-summary-heading" className="text-lg font-semibold">
            {t.summary}
          </h2>
          <p className="whitespace-pre-line">{research.summary}</p>
        </section>
        <section aria-labelledby="research-limitations-heading" className="flex flex-col gap-2">
          <h2 id="research-limitations-heading" className="text-lg font-semibold">
            {t.limitations}
          </h2>
          {research.limitations ? (
            <p className="whitespace-pre-line">{research.limitations}</p>
          ) : (
            <p className="text-muted-foreground">{t.noLimitations}</p>
          )}
        </section>
      </div>

      <section aria-labelledby="research-pains-heading" className="flex flex-col gap-3">
        <h2 id="research-pains-heading" className="text-lg font-semibold">
          {t.pains.replace("{n}", String(pains.total))}
        </h2>
        {pains.total === 0 ? (
          <p className="text-muted-foreground">{t.noPains}</p>
        ) : (
          // 고충 게시판과 같은 목록. 익명 글은 연구별 목록에서 빠지고, 작성자 정보는 listPains의 뷰 규칙을 따른다.
          <div data-testid="research-pains">
            <PainList items={pains.pains} headingLevel={3} />
          </div>
        )}
      </section>

      <section aria-labelledby="research-report-heading" className="flex flex-col gap-3">
        <h2 id="research-report-heading" className="text-lg font-semibold">
          {t.report}
        </h2>
        <ReportViewer researchId={research.id} report={research.report} />
      </section>

      <section aria-labelledby="research-similar-heading" className="flex flex-col gap-3">
        <h2 id="research-similar-heading" className="text-lg font-semibold">
          {t.similar}
        </h2>
        {similar.length === 0 ? (
          <p className="text-muted-foreground">{t.noSimilar}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {similar.map((hit) => (
              <ResearchCard key={hit.id} hit={hit} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
