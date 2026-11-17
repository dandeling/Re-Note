import { PainHitList } from "@/components/research/pain-hit-list";
import { ResearchCard } from "@/components/research/research-card";
import { messages } from "@/lib/messages";
import type { SiteSearchResult } from "@/lib/search";

/**
 * /explore 검색 결과 (SPEC 7.2).
 * 연구가 없으면 "아직 이 사이트에 등록된 연구가 없어요"를 분명히 보여 주고, 관련 고충이 있으면 따로 노출한다.
 */
export function ExploreResults({ result }: { result: SiteSearchResult }) {
  const t = messages.explore;
  const hasResearch = result.research.length > 0;
  const painHeading = (hasResearch ? t.relatedPainsHeading : t.relatedPainsOnlyHeading).replace(
    "{n}",
    String(result.pains.length),
  );

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="explore-research-heading" className="flex flex-col gap-3">
        {hasResearch ? (
          <>
            <h2 id="explore-research-heading" className="text-lg font-semibold">
              {t.researchHeading.replace("{n}", String(result.research.length))}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {result.research.map((hit) => (
                <ResearchCard key={hit.id} hit={hit} />
              ))}
            </div>
          </>
        ) : (
          <div role="status" className="rounded-lg border border-dashed p-6" data-testid="no-research">
            <h2 id="explore-research-heading" className="text-lg font-semibold">
              {t.noResearch}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.noResearchHint}</p>
          </div>
        )}
      </section>
      {result.pains.length > 0 ? (
        <section aria-labelledby="explore-pains-heading" className="flex flex-col gap-3">
          <h2 id="explore-pains-heading" className="text-lg font-semibold">
            {painHeading}
          </h2>
          <PainHitList pains={result.pains} />
        </section>
      ) : hasResearch ? null : (
        <p className="text-sm text-muted-foreground">{t.noPains}</p>
      )}
    </div>
  );
}
