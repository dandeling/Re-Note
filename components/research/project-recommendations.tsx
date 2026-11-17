import { PainHitList } from "@/components/research/pain-hit-list";
import { ResearchCard } from "@/components/research/research-card";
import { messages } from "@/lib/messages";
import { recommendByKeywords } from "@/lib/search";

/** 프로젝트 홈의 "내 키워드와 관련된 연구·고충" 추천 (SPEC 7.2, 7.6). 사이트 내부 데이터만 사용한다. */
export async function ProjectRecommendations({ keywords }: { keywords: string[] }) {
  const t = messages.research;
  const result = keywords.length ? await recommendByKeywords(keywords, { limit: 4 }) : null;
  return (
    <section aria-labelledby="project-recommend-heading" className="flex flex-col gap-3">
      <h2 id="project-recommend-heading" className="text-lg font-semibold">
        {t.recommendHeading}
      </h2>
      {!result ? (
        <p className="text-muted-foreground">{t.recommendNoKeywords}</p>
      ) : result.research.length === 0 && result.pains.length === 0 ? (
        <p role="status" className="text-muted-foreground">
          {t.recommendEmpty}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {result.research.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">{t.recommendResearch}</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {result.research.map((hit) => (
                  <ResearchCard key={hit.id} hit={hit} />
                ))}
              </div>
            </div>
          ) : null}
          {result.pains.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">{t.recommendPains}</h3>
              <PainHitList pains={result.pains} />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
