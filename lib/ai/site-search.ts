import "server-only";
import { searchSite } from "@/lib/search";

/**
 * 챗봇의 search_site 도구가 의존하는 사이트 내부 검색 인터페이스 (SPEC 7.4 → 7.2).
 * 결과에는 작성자 정보를 절대 담지 않는다 (익명 글 작성자 비노출, SPEC 9장).
 */
export type SiteSearchResult = {
  research: { id: string; title: string; summary: string; score: number; path: string }[];
  pains: { id: string; title: string; excerpt: string; score: number; path: string }[];
};

export type SiteSearchOptions = { limit?: number };
export type SiteSearch = (query: string, opts?: SiteSearchOptions) => Promise<SiteSearchResult>;

/**
 * 기본 구현: 연구 탐색(SPEC 7.2)의 `searchSite`를 그대로 재사용한다.
 * `searchSite`의 결과에는 작성자 정보가 없다.
 */
export const defaultSiteSearch: SiteSearch = async (query, opts = {}) => {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
  if (!query.trim()) return { research: [], pains: [] };
  const result = await searchSite(query, { limit });
  return {
    research: result.research.map((r) => ({ id: r.id, title: r.title, summary: r.summary, score: r.score, path: r.path })),
    pains: result.pains.map((p) => ({ id: p.id, title: p.title, excerpt: p.excerpt, score: p.score, path: p.path })),
  };
};
