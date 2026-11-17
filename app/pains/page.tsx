import Link from "next/link";
import { NativeSelect } from "@/components/pains/native-select";
import { PainList } from "@/components/pains/pain-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { messages } from "@/lib/messages";
import { listPainsQuerySchema, PAIN_SORTS, PAIN_STAGES, type ListPainsQuery } from "@/lib/validation/pain";
import { listPainFields, listPains } from "@/server/pains";
import { getCurrentUser } from "@/server/session";

export const metadata = { title: messages.pains.title };

const PAGE_SIZE = 20;

/** 현재 필터를 유지한 채 페이지만 바꾼 주소 */
function pageHref(query: ListPainsQuery, page: number) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.sort !== "latest") params.set("sort", query.sort);
  if (query.stage) params.set("stage", query.stage);
  if (query.field) params.set("field", query.field);
  if (query.tag) params.set("tag", query.tag);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/pains?${qs}` : "/pains";
}

/** 고충 게시판 목록. 비로그인도 볼 수 있다 (SPEC 7.1). */
export default async function PainsPage({ searchParams }: PageProps<"/pains">) {
  const t = messages.pains;
  const raw = await searchParams;
  // 같은 키가 여러 번 오면 첫 값만 쓴다. 잘못된 값이면 기본 목록을 보여 준다.
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = listPainsQuerySchema.safeParse({ ...flat, pageSize: PAGE_SIZE, researchId: undefined });
  const query = parsed.success ? parsed.data : listPainsQuerySchema.parse({ pageSize: PAGE_SIZE });

  const viewer = await getCurrentUser();
  const [result, fields] = await Promise.all([
    listPains({ ...query, viewerId: viewer?.id ?? null }),
    listPainFields(),
  ]);
  const filterCount = [query.stage, query.field, query.tag].filter(Boolean).length;
  const filtered = Boolean(query.q || filterCount);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <p className="text-muted-foreground">{t.intro}</p>
        </div>
        <Button asChild>
          <Link href="/pains/new">{t.new}</Link>
        </Button>
      </header>

      {/* 검색어·정렬만 먼저 보이고, 단계·분야·태그 필터는 "필터"를 눌러야 펼쳐진다(적용 중이면 펼친 채로). */}
      <form method="get" action="/pains" role="search" aria-label={t.filters.heading} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Label htmlFor="pain-q" className="sr-only">
            {t.filters.q}
          </Label>
          <Input
            id="pain-q"
            name="q"
            type="search"
            maxLength={200}
            placeholder={t.filters.qPlaceholder}
            defaultValue={query.q ?? ""}
            className="min-w-48 flex-1"
          />
          <Label htmlFor="pain-sort" className="sr-only">
            {t.filters.sort}
          </Label>
          <NativeSelect id="pain-sort" name="sort" defaultValue={query.sort} className="w-auto">
            {PAIN_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {sort === "latest" ? t.filters.sortLatest : t.filters.sortPopular}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline">
            {t.filters.search}
          </Button>
        </div>
        <details open={filterCount > 0} className="group text-sm">
          <summary className="w-fit cursor-pointer rounded px-1 py-1 text-muted-foreground hover:text-foreground">
            {filterCount > 0 ? t.filters.toggleCount.replace("{n}", String(filterCount)) : t.filters.toggle}
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pain-filter-stage">{t.filters.stage}</Label>
              <NativeSelect id="pain-filter-stage" name="stage" defaultValue={query.stage ?? ""}>
                <option value="">{t.filters.stageAll}</option>
                {PAIN_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {t.stages[stage]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pain-filter-field">{t.filters.field}</Label>
              <Input
                id="pain-filter-field"
                name="field"
                list="pain-field-options"
                maxLength={100}
                placeholder={t.filters.fieldPlaceholder}
                defaultValue={query.field ?? ""}
              />
              <datalist id="pain-field-options">
                {fields.map((field) => (
                  <option key={field} value={field} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pain-filter-tag">{t.filters.tag}</Label>
              <Input id="pain-filter-tag" name="tag" maxLength={30} placeholder={t.filters.tagPlaceholder} defaultValue={query.tag ?? ""} />
            </div>
          </div>
          {filterCount > 0 ? (
            <p className="mt-2">
              <Link href={query.q ? `/pains?q=${encodeURIComponent(query.q)}` : "/pains"} className="text-primary hover:underline">
                {t.filters.reset}
              </Link>
            </p>
          ) : null}
        </details>
      </form>

      <section aria-labelledby="pain-list-heading" className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <h2 id="pain-list-heading" className="sr-only">
            {t.listHeading}
          </h2>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {t.resultCount.replace("{n}", String(result.total))}
          </span>
        </div>
        {result.pains.length === 0 ? (
          <p className="text-muted-foreground">{filtered ? t.emptyFiltered : t.empty}</p>
        ) : (
          <PainList items={result.pains} headingLevel={3} />
        )}
      </section>

      {result.totalPages > 1 ? (
        <nav aria-label={t.pagination.label} className="flex items-center justify-center gap-3 text-sm">
          {result.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(query, result.page - 1)} rel="prev">
                {t.pagination.prev}
              </Link>
            </Button>
          ) : null}
          <span>
            {t.pagination.status.replace("{page}", String(result.page)).replace("{total}", String(result.totalPages))}
          </span>
          {result.page < result.totalPages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(query, result.page + 1)} rel="next">
                {t.pagination.next}
              </Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
