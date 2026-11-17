import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/pains/markdown";
import { OwnerActions } from "@/components/pains/owner-actions";
import { painAuthorName } from "@/components/pains/pain-list";
import { ReactionButton } from "@/components/pains/reaction-button";
import { ReportButton } from "@/components/pains/report-button";
import { Badge } from "@/components/ui/badge";
import { messages } from "@/lib/messages";
import { findPain } from "@/server/pains";
import { getCurrentUser } from "@/server/session";

const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });

export async function generateMetadata({ params }: PageProps<"/pains/[id]">): Promise<Metadata> {
  const { id } = await params;
  const found = await findPain(id, null);
  return { title: found?.title ?? messages.common.notFoundTitle };
}

/**
 * 고충 상세 + "나도 겪었어요". 비로그인도 볼 수 있다 (SPEC 7.1).
 * 고충은 한 번에 쓰는 글이라 댓글 구역이 없다(docs/decisions.md pains-9). 주 동작은 "나도 겪었어요" 하나이고,
 * 신고와 작성자 도구(해결됨 표시·수정·삭제)는 그 옆에 접혀 있다.
 * 화면에 쓰는 데이터는 server/pains.ts의 뷰 타입뿐이라 익명 글의 작성자 정보는 HTML에 들어가지 않는다.
 */
export default async function PainDetailPage({ params }: PageProps<"/pains/[id]">) {
  const t = messages.pains;
  const { id } = await params;
  const viewer = await getCurrentUser();
  const pain = await findPain(id, viewer?.id ?? null);
  if (!pain) notFound();
  const loginHref = `/login?callbackUrl=${encodeURIComponent(`/pains/${pain.id}`)}`;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10">
      <p>
        <Link href="/pains" className="text-sm text-primary hover:underline">
          ← {t.detail.back}
        </Link>
      </p>
      <article className="flex flex-col gap-5">
        <header className="flex flex-col gap-2">
          <div>
            <Badge variant={pain.resolved ? "success" : "outline"}>
              {pain.resolved ? t.resolvedBadge : t.unresolvedBadge}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold leading-snug">{pain.title}</h1>
          <p className="flex flex-wrap gap-x-1.5 text-sm text-muted-foreground">
            <span data-testid="pain-author">{painAuthorName(pain.author)}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={pain.createdAt.toISOString()}>
              {t.detail.postedAt.replace("{date}", dateFormat.format(pain.createdAt))}
            </time>
            <span aria-hidden="true">·</span>
            <span>{[t.stages[pain.stage], pain.field || null].filter(Boolean).join(" · ")}</span>
            {pain.isMine ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t.mineBadge}</span>
              </>
            ) : null}
          </p>
        </header>

        {pain.resolved && pain.resolution ? (
          // 해결 방법은 본문보다 위에 강조해 보여 준다 (SPEC 7.1 완료 기준).
          <section
            aria-labelledby="pain-resolution-heading"
            data-testid="pain-resolution"
            className="rounded-lg border-2 border-emerald-700 bg-emerald-50 p-4 text-emerald-950"
          >
            <h2 id="pain-resolution-heading" className="mb-2 flex items-center gap-2 text-base font-bold">
              <span aria-hidden="true">✓</span>
              {t.resolution.heading}
            </h2>
            <Markdown source={pain.resolution} />
          </section>
        ) : null}

        <Markdown source={pain.body} />

        {pain.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label={t.filters.tag}>
            {pain.tags.map((tag) => (
              <li key={tag}>
                <Link href={`/pains?tag=${encodeURIComponent(tag)}`} className="text-sm text-primary hover:underline">
                  #{tag}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {pain.researchId || (pain.isMine && pain.projectId) ? (
          <p className="flex flex-wrap gap-x-4 text-sm">
            {pain.researchId ? (
              <Link href={`/research/${pain.researchId}`} className="text-primary hover:underline">
                {t.detail.linkedResearch}
              </Link>
            ) : null}
            {pain.isMine && pain.projectId ? (
              <Link href={`/projects/${pain.projectId}`} className="text-primary hover:underline">
                {t.detail.linkedProject}
              </Link>
            ) : null}
          </p>
        ) : null}

        <div className="flex flex-wrap items-start gap-3 border-t pt-4">
          {viewer ? (
            <ReactionButton painId={pain.id} count={pain.meTooCount} reacted={pain.reactedByMe} />
          ) : (
            <p className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{t.meTooCount.replace("{n}", String(pain.meTooCount))}</span>
              <Link href={loginHref} className="text-primary underline">
                {t.reaction.loginRequired}
              </Link>
            </p>
          )}
          {viewer && !pain.isMine ? <ReportButton painId={pain.id} /> : null}
        </div>
      </article>

      {pain.isMine ? (
        // 작성자 도구는 접어 둔다. 펼치면 해결됨 표시(해결 방법)·수정·삭제가 나온다.
        <details className="rounded-lg bg-muted/60 px-4 py-3" data-testid="pain-owner-tools">
          <summary className="cursor-pointer text-sm font-medium">{t.detail.ownerHeading}</summary>
          <div className="mt-3">
            <OwnerActions painId={pain.id} resolved={pain.resolved} resolution={pain.resolution} />
          </div>
        </details>
      ) : null}
    </main>
  );
}
