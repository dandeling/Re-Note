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
 *
 * 카드는 제목 · 요약 · 메타 한 줄만 보여 준다. 배지는 "해결됨" 하나뿐이고(단순화 원칙: 카드당 최대 2개),
 * 단계·분야·작성자·날짜·공감 수·태그는 메타 줄의 글자로 보여 준다(태그 링크는 상세 화면에 있다).
 */
export function PainList({ items, headingLevel = 2 }: { items: PainListItem[]; headingLevel?: 2 | 3 }) {
  const t = messages.pains;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul className="divide-y">
      {items.map((pain) => (
        <li key={pain.id} className="flex flex-col gap-1.5 py-4">
          <Heading className="flex flex-wrap items-center gap-2 text-base font-semibold leading-snug">
            <Link href={`/pains/${pain.id}`} className="rounded hover:underline focus-visible:outline-2">
              {pain.title}
            </Link>
            {pain.resolved ? <Badge variant="success">{t.resolvedBadge}</Badge> : null}
          </Heading>
          {pain.excerpt ? <p className="line-clamp-2 text-sm text-muted-foreground">{pain.excerpt}</p> : null}
          <p className="text-xs text-muted-foreground">
            {[
              t.stages[pain.stage],
              pain.field || null,
              painAuthorName(pain.author),
              dateFormat.format(pain.createdAt),
              t.meTooCount.replace("{n}", String(pain.meTooCount)),
              pain.tags.length > 0 ? pain.tags.map((tag) => `#${tag}`).join(" ") : null,
              pain.isMine ? t.mineBadge : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </li>
      ))}
    </ul>
  );
}
