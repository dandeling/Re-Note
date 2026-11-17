import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { messages } from "@/lib/messages";
import type { PainSearchHit } from "@/lib/search";

/** 검색·추천으로 찾은 고충 목록. 작성자 정보는 보여 주지 않는다(익명 글 보호). */
export function PainHitList({ pains, showScore = true }: { pains: PainSearchHit[]; showScore?: boolean }) {
  const t = messages.explore;
  return (
    <ul className="divide-y rounded-lg border" data-testid="pain-hits">
      {pains.map((p) => (
        <li key={p.id} className="flex flex-col gap-1 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={p.path} className="font-medium hover:underline">
              {p.title}
            </Link>
            <Badge variant={p.resolved ? "success" : "outline"}>{p.resolved ? t.resolved : t.unresolved}</Badge>
            {showScore ? (
              <span className="text-xs text-muted-foreground">
                {t.similarity.replace("{p}", String(Math.round(p.score * 100)))}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{p.excerpt}</p>
        </li>
      ))}
    </ul>
  );
}
