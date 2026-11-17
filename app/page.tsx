import Link from "next/link";
import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { messages } from "@/lib/messages";
import { countPains } from "@/server/pains";

const LINKS = [
  { href: "/explore", key: "explore" },
  { href: "/pains", key: "pains" },
  { href: "/projects", key: "projects" },
] as const;

/**
 * 홈: 제목 한 줄 + 설명 한 줄 + 통합 검색창(제출하면 /explore) + 실제 개수 + 바로 가기 3개.
 * 주 동작은 검색 하나뿐이다(artifact/CONTRACT.md "UI 단순화 원칙").
 */
export default async function Home() {
  const t = messages.home;
  // 개수는 요청마다 DB에서 센다(빌드 때 미리 그려 두지 않는다).
  await connection();
  const [researchCount, painCount] = await Promise.all([prisma.research.count(), countPains()]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-12 px-4 pb-16">
      <section className="home-hero flex w-full flex-col items-center gap-5 pt-[clamp(28px,11vh,104px)] text-center">
        <h1 className="max-w-[12em] break-keep text-[clamp(1.7rem,5.4vw,2.7rem)] font-bold leading-snug tracking-tight">
          {t.titleBefore}
          <mark className="whitespace-nowrap">{t.titleMark}</mark>
          {t.titleAfter}
        </h1>
        <p className="max-w-[34em] break-keep text-muted-foreground">{t.lead}</p>
        <form
          action="/explore"
          role="search"
          className="flex w-full max-w-xl items-center gap-1.5 rounded-full border bg-background p-1.5 shadow-sm focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15"
        >
          <Input
            type="search"
            name="q"
            required
            maxLength={200}
            aria-label={t.searchLabel}
            placeholder={t.searchPlaceholder}
            className="h-10 flex-1 rounded-full border-0 bg-transparent px-4 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <Button type="submit" className="h-10 rounded-full px-6">
            {t.searchButton}
          </Button>
        </form>
        <p className="text-sm tabular-nums text-muted-foreground" data-testid="home-stats">
          {t.stats.replace("{research}", String(researchCount)).replace("{pains}", String(painCount))}
        </p>
      </section>

      <nav aria-label={t.linksLabel} className="grid w-full max-w-3xl gap-3 sm:grid-cols-3">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex flex-col gap-1 rounded-xl border bg-background px-5 py-4 text-left transition-colors hover:border-primary"
          >
            <span className="flex justify-between gap-2 font-semibold">
              {t.links[link.key].title}
              <span aria-hidden="true" className="text-primary">
                →
              </span>
            </span>
            <span className="break-keep text-sm text-muted-foreground">{t.links[link.key].text}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
