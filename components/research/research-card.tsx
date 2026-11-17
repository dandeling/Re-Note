import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { messages } from "@/lib/messages";
import type { ResearchSearchHit } from "@/lib/search";

/** 연구 카드: 제목, 요약, 키워드, 유사도 + "고충 N건 · 한계 요약 · 결과보고서 유무" 배지 (SPEC 7.2) */
export function ResearchCard({ hit, showScore = true }: { hit: ResearchSearchHit; showScore?: boolean }) {
  const t = messages.explore;
  return (
    <Card data-testid="research-card" className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>
            <Link href={hit.path} className="hover:underline">
              {hit.title}
            </Link>
          </CardTitle>
          {showScore ? (
            <Badge variant="outline" className="shrink-0">
              {t.similarity.replace("{p}", String(Math.round(hit.score * 100)))}
            </Badge>
          ) : null}
        </div>
        <CardDescription>{hit.summary}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {hit.field ? <Badge variant="secondary">{hit.field}</Badge> : null}
          {hit.keywords.map((k) => (
            <Badge key={k} variant="secondary">
              {k}
            </Badge>
          ))}
        </div>
        <ul className="flex flex-wrap gap-1.5" aria-label={hit.title}>
          <li>
            <Badge variant="outline">{t.painCount.replace("{n}", String(hit.painCount))}</Badge>
          </li>
          <li>
            <Badge variant="outline" className="max-w-full whitespace-normal">
              {hit.limitations ? t.limitationsBadge.replace("{text}", hit.limitations) : t.noLimitations}
            </Badge>
          </li>
          <li>
            <Badge variant={hit.hasReport ? "success" : "outline"}>{hit.hasReport ? t.hasReport : t.noReport}</Badge>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
