// 사이트 내부 검색 (SPEC 7.2). 챗봇의 search_site 도구는 여기의 `searchSite`를 그대로 쓴다.
export {
  SEARCH_TUNING,
  excerpt,
  findSimilarResearch,
  recommendByKeywords,
  searchSite,
  tokenizeQuery,
  type PainSearchHit,
  type ResearchSearchHit,
  type SearchKind,
  type SearchSiteOptions,
  type SiteSearchHit,
  type SiteSearchResult,
} from "@/lib/search/site-search";
export { FakeEmbeddingProvider, getEmbeddingProvider, toVectorLiteral, type EmbeddingProvider } from "@/lib/search/embedding";
export { backfillEmbeddings, indexEmbedding } from "@/lib/search/indexing";
