import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { messages } from "@/lib/messages";
import type { PainListItem } from "@/server/pains";

const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });

/** 작성자 표시 이름: 익명 글은 "익명" */
export function painAuthorName(author: { name: string | null } | null) {
  const t = messages.pains;
  return author ? author.name || t.noName : t.anonymous;
}

/**
 * 고충 목록. `/pains`, 프로젝트 홈의 "내 고충", 연구 상세의 "연결된 고충"이 같이 쓴다.
 * `listPains()`의 결과(`pains`)를 그대로 넘기면 된다.
 */
export function PainList({ items, headingLevel = 2 }: { items: PainListItem[]; headingLevel?: 2 | 3 }) {
  const t = messages.pains;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((pain) => (
        <li key={pain.id} className="flex flex-col gap-2 px-4 py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={pain.resolved ? "success" : "outline"}>
              {pain.resolved ? t.resolvedBadge : t.unresolvedBadge}
            </Badge>
            <Badge variant="secondary">{t.stages[pain.stage]}</Badge>
            {pain.field ? <Badge variant="secondary">{pain.field}</Badge> : null}
            {pain.isMine ? <Badge variant="outline">{t.mineBadge}</Badge> : null}
          </div>
          <Heading className="text-base font-semibold leading-snug">
            <Link href={`/pains/${pain.id}`} className="rounded hover:underline focus-visible:outline-2">
              {pain.title}
            </Link>
          </Heading>
          {pain.excerpt ? <p className="line-clamp-2 text-sm text-muted-foreground">{pain.excerpt}</p> : null}
          {pain.tags.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label={t.filters.tag}>
              {pain.tags.map((tag) => (
                <li key={tag}>
                  <Link
                    href={`/pains?tag=${encodeURIComponent(tag)}`}
                    className="text-xs text-primary hover:underline"
                  >
                    #{tag}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{painAuthorName(pain.author)}</span>
            <time dateTime={pain.createdAt.toISOString()}>{dateFormat.format(pain.createdAt)}</time>
            <span>{t.meTooCount.replace("{n}", String(pain.meTooCount))}</span>
            <span>{t.commentCount.replace("{n}", String(pain.commentCount))}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
