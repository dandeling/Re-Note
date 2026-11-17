import { ExploreResults } from "@/components/research/explore-results";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/lib/messages";
import { searchSite } from "@/lib/search";

export const metadata = { title: messages.explore.title };

/** 연구 탐색 (SPEC 7.2). 비로그인도 사용할 수 있다. 검색은 이 사이트의 데이터만 사용한다. */
export default async function ExplorePage({ searchParams }: PageProps<"/explore">) {
  const t = messages.explore;
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 200) ?? "";
  const result = q ? await searchSite(q, { limit: 20 }) : null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{t.title}</h1>
        <p className="text-muted-foreground">{t.intro}</p>
      </header>
      <form action="/explore" role="search" className="flex w-full max-w-2xl gap-2">
        <Input
          name="q"
          defaultValue={q}
          maxLength={200}
          aria-label={t.searchLabel}
          placeholder={t.searchPlaceholder}
        />
        <Button type="submit">{t.searchButton}</Button>
      </form>
      {result ? (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t.resultsFor.replace("{q}", q)}
          </p>
          <ExploreResults result={result} />
        </>
      ) : (
        <p className="text-muted-foreground">{t.promptEmpty}</p>
      )}
    </main>
  );
}
