import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommentForm } from "@/components/pains/comment-form";
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
  return { title: found?.pain.title ?? messages.common.notFoundTitle };
}

/**
 * 고충 상세 + 댓글 + "나도 겪었어요". 비로그인도 볼 수 있다 (SPEC 7.1).
 * 화면에 쓰는 데이터는 server/pains.ts의 뷰 타입뿐이라 익명 글의 작성자 정보는 HTML에 들어가지 않는다.
 */
export default async function PainDetailPage({ params }: PageProps<"/pains/[id]">) {
  const t = messages.pains;
  const { id } = await params;
  const viewer = await getCurrentUser();
  const found = await findPain(id, viewer?.id ?? null);
  if (!found) notFound();
  const { pain, comments } = found;
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
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={pain.resolved ? "success" : "outline"}>
              {pain.resolved ? t.resolvedBadge : t.unresolvedBadge}
            </Badge>
            <Badge variant="secondary">{t.stages[pain.stage]}</Badge>
            {pain.field ? <Badge variant="secondary">{pain.field}</Badge> : null}
            {pain.isMine ? <Badge variant="outline">{t.mineBadge}</Badge> : null}
          </div>
          <h1 className="text-2xl font-bold leading-snug">{pain.title}</h1>
          <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            <span data-testid="pain-author">{painAuthorName(pain.author)}</span>
            <time dateTime={pain.createdAt.toISOString()}>
              {t.detail.postedAt.replace("{date}", dateFormat.format(pain.createdAt))}
            </time>
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

        <div className="flex flex-wrap items-start justify-between gap-3 border-t pt-4">
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
        <section aria-labelledby="pain-owner-heading" className="rounded-lg border p-4">
          <h2 id="pain-owner-heading" className="mb-3 text-lg font-semibold">
            {t.detail.ownerHeading}
          </h2>
          <OwnerActions painId={pain.id} resolved={pain.resolved} resolution={pain.resolution} />
        </section>
      ) : null}

      <section aria-labelledby="pain-comments-heading" className="flex flex-col gap-4">
        <h2 id="pain-comments-heading" className="text-lg font-semibold">
          {t.comments.heading.replace("{n}", String(comments.length))}
        </h2>
        {comments.length === 0 ? (
          <p className="text-muted-foreground">{t.comments.empty}</p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {comments.map((comment) => (
              <li key={comment.id} className="flex flex-col gap-1.5 px-4 py-3">
                <p className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className="font-medium">{painAuthorName(comment.author)}</span>
                  {comment.isPostAuthor ? <Badge variant="secondary">{t.postAuthorBadge}</Badge> : null}
                  <time dateTime={comment.createdAt.toISOString()} className="text-xs text-muted-foreground">
                    {dateFormat.format(comment.createdAt)}
                  </time>
                </p>
                <Markdown source={comment.body} className="text-sm" />
              </li>
            ))}
          </ol>
        )}
        {viewer ? (
          <CommentForm painId={pain.id} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t.comments.loginRequired}{" "}
            <Link href={loginHref} className="text-primary underline">
              {t.comments.login}
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}
