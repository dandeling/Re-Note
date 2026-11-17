import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { log } from "@/lib/log";
import { getEmbeddingProvider, toVectorLiteral, type EmbeddingProvider } from "@/lib/search/embedding";

/**
 * 사이트 내부 하이브리드 검색 (SPEC 7.2).
 *
 * 검색 대상은 이 사이트에 공개된 `Research`와 `PainPost`뿐이며 외부 서비스는 호출하지 않는다.
 * (임베딩 제공자가 설정된 경우에만 질의문 임베딩을 위해 그 제공자를 호출한다.)
 *
 * 1) trigram: `SearchDocument`(자모 분해 정규화 텍스트). 제목·키워드는 `word_similarity`(오타 허용),
 *    요약·한계·본문은 공백을 없앤 텍스트의 부분 문자열 일치(띄어쓰기 차이 허용). 둘 다 gin_trgm_ops 인덱스 사용
 * 2) 벡터: `EmbeddingProvider`가 있으면 pgvector 코사인 유사도
 * 3) 둘을 가중 합산
 *
 * AI 챗봇의 `search_site` 도구도 이 함수를 그대로 쓴다. 결과가 없으면 빈 배열을 돌려주며,
 * 호출하는 쪽은 "없다"고 그대로 알려야 한다(지어내지 않는다).
 */

export type SearchKind = "research" | "pain";

export type ResearchSearchHit = {
  type: "research";
  id: string;
  title: string;
  /** 요약 발췌 */
  summary: string;
  field: string;
  keywords: string[];
  /** 한계 발췌 (없으면 빈 문자열) */
  limitations: string;
  /** 이 연구에 연결된 고충 수 */
  painCount: number;
  /** 결과보고서(PDF) 등록 여부 */
  hasReport: boolean;
  /** 유사도 점수 0~1 (클수록 비슷함) */
  score: number;
  /** 사이트 내 링크 경로 `/research/:id` */
  path: string;
};

export type PainSearchHit = {
  type: "pain";
  id: string;
  title: string;
  /** 본문 발췌 */
  excerpt: string;
  stage: string;
  field: string;
  tags: string[];
  resolved: boolean;
  /** 연결된 연구가 있으면 그 ID */
  researchId: string | null;
  /** 유사도 점수 0~1 */
  score: number;
  /** 사이트 내 링크 경로 `/pains/:id` */
  path: string;
};

export type SiteSearchHit = ResearchSearchHit | PainSearchHit;

export type SiteSearchResult = {
  /** 정리된 검색어 */
  query: string;
  /** 사용된 방식: trigram만 또는 trigram + 벡터 */
  mode: "trigram" | "hybrid";
  research: ResearchSearchHit[];
  pains: PainSearchHit[];
};

export type SearchSiteOptions = {
  /** 종류별 최대 결과 수 (기본 10, 최대 50) */
  limit?: number;
  /** 검색할 종류 (기본: 연구와 고충 모두) */
  kinds?: SearchKind[];
  /** 결과에서 뺄 연구 ID (예: "비슷한 연구"에서 자기 자신) */
  excludeResearchIds?: string[];
  /** 임베딩 제공자. 생략하면 환경변수(`EMBEDDING_PROVIDER`)를 따르고, null이면 trigram만 쓴다. */
  embeddingProvider?: EmbeddingProvider | null;
};

/** 검색 조정값. 근거는 docs/decisions.md search-2 */
export const SEARCH_TUNING = {
  defaultLimit: 10,
  maxLimit: 50,
  maxQueryLength: 200,
  maxTokens: 6,
  /** 검색어 한 단어가 "일치했다"고 보는 최소 word_similarity */
  tokenFloor: 0.5,
  /**
   * 정규화 길이가 짧은 단어(대략 한글 두 음절 이하)는 우연히 겹치는 trigram이 많아 더 엄격하게 본다.
   * 0.7이면 조사가 붙은 형태("빛" → "빛을", 0.75)와 두 음절 단어의 자모 하나 오타("감쇄" → "감쇠", 0.71)는 통과한다.
   */
  shortTokenLength: 7,
  shortTokenFloor: 0.7,
  /** 본문 부분 문자열 비교에 쓰는 최소 정규화 길이 (한 음절 단어는 제목·키워드에서만 찾는다) */
  minBodyNeedleLength: 4,
  /**
   * 검색어가 여러 단어일 때 단어별 점수 평균의 최소값. 절반만 맞는 문서
   * (예: "양자 컴퓨터"에 대해 "컴퓨터"만 있는 글)는 결과에 넣지 않는다.
   */
  minTokenMean: 0.6,
  /** 본문(요약·한계·고충 본문) 일치는 제목·키워드 일치보다 낮게 친다 */
  bodyWeight: 0.85,
  lexicalWeight: 0.6,
  vectorWeight: 0.4,
  /** trigram으로는 못 찾았지만 벡터만으로 결과에 포함되는 최소 코사인 유사도 */
  minVector: 0.6,
} as const;

/** 검색어를 단어로 나눈다 (공백·쉼표 기준, 중복 제거, 최대 6개). */
export function tokenizeQuery(query: string): string[] {
  const seen = new Set<string>();
  for (const part of query.slice(0, SEARCH_TUNING.maxQueryLength).split(/[\s,]+/)) {
    if (part) seen.add(part);
    if (seen.size >= SEARCH_TUNING.maxTokens) break;
  }
  return [...seen];
}

/** 목록에 보여 줄 짧은 발췌 */
export function excerpt(text: string, max = 160): string {
  const flat = text.replace(/[#*`>_~]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

function emptyResult(query: string, mode: SiteSearchResult["mode"] = "trigram"): SiteSearchResult {
  return { query, mode, research: [], pains: [] };
}

type Scores = Map<string, { lex: number; vec?: number }>;

const TABLE: Record<SearchKind, Prisma.Sql> = {
  research: Prisma.sql`"Research"`,
  pain: Prisma.sql`"PainPost"`,
};

/** trigram 점수: 종류별 상위 후보의 id → 점수 */
async function lexicalCandidates(tokens: string[], kinds: SearchKind[], cap: number) {
  const t = SEARCH_TUNING;
  const out: Record<SearchKind, Scores> = { research: new Map(), pain: new Map() };

  // 문서와 똑같은 SQL 함수로 검색어를 정규화한다 (구현을 한 곳에만 둔다).
  const normRows = await prisma.$queryRaw<{ n: string }[]>`
    SELECT rm_search_normalize(u.t) AS n
    FROM unnest(${tokens}::text[]) WITH ORDINALITY AS u(t, ord)
    ORDER BY u.ord`;
  const norms = [...new Set(normRows.map((r) => r.n.replace(/ /g, "")).filter(Boolean))];
  if (norms.length === 0) return out;
  // 띄어쓰기 차이("음향 블랙홀" ↔ "음향블랙홀")를 위해 붙여 쓴 형태도 함께 본다.
  const compact = norms.join("");
  // 단어들 + (여러 단어일 때) 붙여 쓴 형태. 인덱스 ntok 이상이 붙여 쓴 형태다.
  const ntok = norms.length;
  const needles = ntok > 1 ? [...norms, compact] : norms;

  // 한 단어 검색은 단어 하한(tokenFloor)만 적용한다.
  const minMean = ntok > 1 ? t.minTokenMean : 0;
  const floorOf = (n: string) => (n.length < t.shortTokenLength ? t.shortTokenFloor : t.tokenFloor);
  // 단어마다 "일치한 문서" 목록을 인덱스(gin_trgm_ops)로 뽑아 합친다. 전 행에 word_similarity를 계산하지 않는다.
  //  - 제목·키워드: word_similarity(오타 허용)
  //  - 본문: 공백 없는 정규화 텍스트에 대한 부분 문자열 일치. 정규화 결과에는 LIKE 와일드카드(%, _)가 남지 않는다.
  //    너무 짧은 단어는 본문에서 우연히 겹치므로 제목·키워드에서만 찾는다.
  const hits = Prisma.join(
    needles.flatMap((n, k) => {
      const parts = [
        Prisma.sql`SELECT ${k}::int AS k, q.kind, q."refId", q.s::float8 AS v
                   FROM (SELECT d.kind, d."refId", word_similarity(${n}, d."titleNorm") AS s
                         FROM "SearchDocument" d
                         WHERE ${n} <% d."titleNorm"
                         OFFSET 0) q
                   WHERE q.s >= ${floorOf(n)}`,
      ];
      if (n.length >= t.minBodyNeedleLength) {
        parts.push(Prisma.sql`SELECT ${k}::int AS k, d.kind, d."refId", ${t.bodyWeight}::float8 AS v
                              FROM "SearchDocument" d
                              WHERE d."bodyNorm" LIKE ${`%${n}%`}`);
      }
      return parts;
    }),
    " UNION ALL ",
  );

  const [, , rows] = await prisma.$transaction([
    prisma.$queryRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(t.tokenFloor)}, true)`,
    // 행 수가 적을 때 플래너가 순차 탐색을 고르면 word_similarity를 전 행에 계산하게 된다. 인덱스를 쓰게 한다.
    prisma.$queryRaw`SELECT set_config('enable_seqscan', 'off', true)`,
    prisma.$queryRaw<{ kind: string; id: string; lex: number }[]>`
      SELECT r.kind, r."refId" AS id, r.lex
      FROM (
        SELECT s.kind, s."refId", s.lex,
               row_number() OVER (PARTITION BY s.kind ORDER BY s.lex DESC, s."refId") AS rn
        FROM (
          SELECT b.kind, b."refId",
                 GREATEST(CASE WHEN b.tok / ${ntok}::float8 >= ${minMean} THEN b.tok / ${ntok}::float8 ELSE 0 END, b.comp) AS lex
          FROM (
            SELECT a.kind, a."refId",
                   coalesce(sum(a.v) FILTER (WHERE a.k < ${ntok}), 0) AS tok,
                   coalesce(max(a.v) FILTER (WHERE a.k >= ${ntok}), 0) AS comp
            FROM (SELECT h.k, h.kind, h."refId", max(h.v) AS v FROM (${hits}) h GROUP BY h.k, h.kind, h."refId") a
            GROUP BY a.kind, a."refId"
          ) b
        ) s
        -- 종류 필터를 안쪽에 두면 플래너가 기본키(kind, refId)로 전 행을 훑을 수 있어 바깥에서 거른다.
        WHERE s.lex > 0 AND s.kind = ANY(${kinds}::text[])
      ) r
      WHERE r.rn <= ${cap}`,
  ]);
  for (const row of rows) {
    if (row.kind === "research" || row.kind === "pain") out[row.kind].set(row.id, { lex: Number(row.lex) });
  }
  return out;
}

/** 벡터 점수를 후보에 합친다. 벡터만으로 충분히 가까운 문서도 후보에 추가한다. */
async function addVectorScores(
  provider: EmbeddingProvider,
  query: string,
  kinds: SearchKind[],
  candidates: Record<SearchKind, Scores>,
  cap: number,
) {
  const [vector] = await provider.embed([query]);
  if (!vector || vector.length !== provider.dimensions) throw new Error("임베딩 차원이 제공자 설정과 다릅니다.");
  const literal = toVectorLiteral(vector);
  const dims = provider.dimensions;

  for (const kind of kinds) {
    const table = TABLE[kind];
    const scores = candidates[kind];
    // 차원이 다른 벡터와 비교하면 오류가 나므로 CASE로 먼저 거른다 (embedding은 차원 미지정 vector).
    const distance = Prisma.sql`(CASE WHEN vector_dims(e.embedding) = ${dims} THEN e.embedding <=> ${literal}::vector END)`;
    const usable = Prisma.sql`e.embedding IS NOT NULL AND vector_dims(e.embedding) = ${dims}`;
    const nearest = await prisma.$queryRaw<{ id: string; sim: number }[]>`
      SELECT e.id, (1 - ${distance})::float8 AS sim
      FROM ${table} e
      WHERE ${usable}
      ORDER BY ${distance}
      LIMIT ${cap}`;
    const known = [...scores.keys()];
    const forKnown = known.length
      ? await prisma.$queryRaw<{ id: string; sim: number }[]>`
          SELECT e.id, (1 - ${distance})::float8 AS sim
          FROM ${table} e
          WHERE e.id = ANY(${known}::text[]) AND ${usable}`
      : [];
    for (const row of forKnown) {
      const entry = scores.get(row.id);
      if (entry) entry.vec = Math.max(0, Number(row.sim));
    }
    for (const row of nearest) {
      const sim = Number(row.sim);
      if (!scores.has(row.id) && sim >= SEARCH_TUNING.minVector) scores.set(row.id, { lex: 0, vec: sim });
    }
  }
}

function finalScore(entry: { lex: number; vec?: number }): number {
  const t = SEARCH_TUNING;
  // 임베딩이 없는 문서는 trigram 점수만으로 평가한다.
  const score = entry.vec === undefined ? entry.lex : t.lexicalWeight * entry.lex + t.vectorWeight * entry.vec;
  return Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
}

function ranked(scores: Scores, limit: number, exclude: Set<string> = new Set()) {
  return [...scores.entries()]
    .filter(([id]) => !exclude.has(id))
    .map(([id, entry]) => ({ id, score: finalScore(entry) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * 키워드로 사이트에 공개된 연구·고충을 찾는다.
 * 결과에는 작성자 정보가 들어가지 않는다(익명 고충 보호).
 */
export async function searchSite(query: string, opts: SearchSiteOptions = {}): Promise<SiteSearchResult> {
  const tokens = tokenizeQuery(query);
  const cleaned = tokens.join(" ");
  if (tokens.length === 0) return emptyResult(cleaned);

  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? SEARCH_TUNING.defaultLimit)), SEARCH_TUNING.maxLimit);
  const kinds: SearchKind[] = opts.kinds?.length ? [...new Set(opts.kinds)] : ["research", "pain"];
  const exclude = new Set(opts.excludeResearchIds ?? []);
  const cap = limit * 3 + exclude.size;

  const candidates = await lexicalCandidates(tokens, kinds, cap);

  let mode: SiteSearchResult["mode"] = "trigram";
  const provider = opts.embeddingProvider === undefined ? getEmbeddingProvider() : opts.embeddingProvider;
  if (provider) {
    try {
      await addVectorScores(provider, cleaned, kinds, candidates, cap);
      mode = "hybrid";
    } catch (err) {
      // 임베딩이 실패해도 trigram 결과는 그대로 돌려준다.
      for (const scores of Object.values(candidates)) for (const entry of scores.values()) delete entry.vec;
      for (const scores of Object.values(candidates)) for (const [id, e] of scores) if (e.lex === 0) scores.delete(id);
      log.warn("search.embedding_failed", { provider: provider.name, error: String(err) });
    }
  }

  const researchRank = ranked(candidates.research, limit, exclude);
  const painRank = ranked(candidates.pain, limit);

  const [researchRows, painRows] = await Promise.all([
    researchRank.length
      ? prisma.research.findMany({
          where: { id: { in: researchRank.map((r) => r.id) } },
          select: {
            id: true,
            title: true,
            summary: true,
            field: true,
            keywords: true,
            limitations: true,
            reportAsset: { select: { deletedAt: true } },
            // 익명 고충은 연구별 목록에 나오지 않으므로 세지 않는다 (server/pains.ts listPains와 같은 규칙).
            _count: { select: { painPosts: { where: { isAnonymous: false } } } },
          },
        })
      : [],
    painRank.length
      ? prisma.painPost.findMany({
          where: { id: { in: painRank.map((p) => p.id) } },
          // 작성자 정보는 조회하지 않는다.
          select: { id: true, title: true, body: true, stage: true, field: true, tags: true, resolved: true, researchId: true, isAnonymous: true },
        })
      : [],
  ]);
  const researchById = new Map(researchRows.map((r) => [r.id, r]));
  const painById = new Map(painRows.map((p) => [p.id, p]));

  const research: ResearchSearchHit[] = [];
  for (const { id, score } of researchRank) {
    const r = researchById.get(id);
    if (!r) continue;
    research.push({
      type: "research",
      id,
      title: r.title,
      summary: excerpt(r.summary, 200),
      field: r.field,
      keywords: r.keywords,
      limitations: excerpt(r.limitations, 120),
      painCount: r._count.painPosts,
      hasReport: Boolean(r.reportAsset && !r.reportAsset.deletedAt),
      score,
      path: `/research/${id}`,
    });
  }
  const pains: PainSearchHit[] = [];
  for (const { id, score } of painRank) {
    const p = painById.get(id);
    if (!p) continue;
    pains.push({
      type: "pain",
      id,
      title: p.title,
      excerpt: excerpt(p.body),
      stage: p.stage,
      field: p.field,
      tags: p.tags,
      resolved: p.resolved,
      // 익명 글은 연결된 연구(작성자 공개)를 내보내지 않는다 (server/pains.ts toSummary와 같은 규칙).
      researchId: p.isAnonymous ? null : p.researchId,
      score,
      path: `/pains/${id}`,
    });
  }
  return { query: cleaned, mode, research, pains };
}

/**
 * 키워드 여러 개 중 하나라도 관련 있는 연구·고충을 추천한다 (프로젝트 홈, "비슷한 연구").
 * 키워드마다 `searchSite`를 실행해 문서별 최고 점수로 합친다.
 */
export async function recommendByKeywords(keywords: string[], opts: SearchSiteOptions = {}): Promise<SiteSearchResult> {
  const unique = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 6);
  const limit = opts.limit ?? 5;
  if (unique.length === 0) return emptyResult("");
  const results = await Promise.all(unique.map((k) => searchSite(k, { ...opts, limit })));

  const best = <T extends SiteSearchHit>(lists: T[][]) => {
    const byId = new Map<string, T>();
    for (const hit of lists.flat()) {
      const prev = byId.get(hit.id);
      if (!prev || hit.score > prev.score) byId.set(hit.id, hit);
    }
    return [...byId.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  };
  return {
    query: unique.join(", "),
    mode: results.some((r) => r.mode === "hybrid") ? "hybrid" : "trigram",
    research: best(results.map((r) => r.research)),
    pains: best(results.map((r) => r.pains)),
  };
}

/** 연구 상세 하단의 "비슷한 연구": 키워드(없으면 제목)로 찾고 자기 자신은 뺀다. */
export async function findSimilarResearch(
  research: { id: string; title: string; keywords: string[] },
  limit = 4,
): Promise<ResearchSearchHit[]> {
  const opts: SearchSiteOptions = { kinds: ["research"], excludeResearchIds: [research.id], limit };
  const result = research.keywords.length
    ? await recommendByKeywords(research.keywords, opts)
    : await searchSite(research.title, opts);
  return result.research;
}
