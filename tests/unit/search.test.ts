import { beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/search/route";
import { prisma } from "@/lib/db";
import {
  FakeEmbeddingProvider,
  backfillEmbeddings,
  findSimilarResearch,
  getEmbeddingProvider,
  recommendByKeywords,
  searchSite,
  tokenizeQuery,
  type EmbeddingProvider,
} from "@/lib/search";
import { seedResearchAndPains } from "@/prisma/seed-research";
import { createUser, resetDb } from "../setup/db";
import { jsonRequest } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

const ABH = "음향 블랙홀 구조를 이용한 얇은 판의 진동 감쇠 효과 측정";

describe("searchSite: trigram 검색 (EMBEDDING_PROVIDER 없음)", () => {
  beforeAll(async () => {
    await resetDb();
    await seedResearchAndPains(prisma);
  });

  it("환경변수가 비어 있으면 임베딩 제공자가 없고 trigram만으로 동작한다", async () => {
    expect(process.env.EMBEDDING_PROVIDER ?? "").toBe("");
    expect(getEmbeddingProvider()).toBeNull();
    const result = await searchSite("음향 블랙홀 진동 감쇠");
    expect(result.mode).toBe("trigram");
    expect(result.research[0]).toMatchObject({ type: "research", title: ABH, score: 1 });
  });

  it("연구 결과에는 요약·키워드·한계·고충 수·보고서 유무·링크가 들어 있다", async () => {
    const [hit] = (await searchSite("음향 블랙홀")).research;
    expect(hit.path).toBe(`/research/${hit.id}`);
    expect(hit.summary).toContain("알루미늄 판");
    expect(hit.keywords).toContain("진동 감쇠");
    expect(hit.limitations).toContain("저주파");
    expect(hit.painCount).toBe(1);
    expect(hit.hasReport).toBe(false);
  });

  it("고충도 함께 찾고, 작성자 정보는 결과 어디에도 없다", async () => {
    const result = await searchSite("가속도 센서");
    const pain = result.pains.find((p) => p.title.startsWith("가속도 센서 무게"));
    expect(pain).toBeDefined();
    expect(pain!.path).toBe(`/pains/${pain!.id}`);
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/authorId|author|email|seed-/);
    for (const name of ["김하늘", "이준서", "박서연"]) expect(text).not.toContain(name);
  });

  it("요약·한계·본문에만 있는 단어로도 찾는다", async () => {
    expect((await searchSite("점탄성 테이프")).research[0].title).toBe(ABH);
    expect((await searchSite("표피 깊이")).research[0].title).toContain("와전류");
    expect((await searchSite("화이트밸런스")).pains[0].title).toContain("조명");
  });

  it("없는 주제는 빈 결과를 돌려준다 (지어내지 않는다)", async () => {
    for (const q of ["초전도체", "블록체인", "축구", "양자 컴퓨터", "고양이 행동", "asdf qwer"]) {
      const result = await searchSite(q);
      expect(result.research, q).toEqual([]);
      expect(result.pains, q).toEqual([]);
    }
  });

  it("빈 검색어·기호뿐인 검색어는 빈 결과", async () => {
    for (const q of ["", "   ", "!!! ???", ",,,"]) {
      const result = await searchSite(q);
      expect(result.research).toEqual([]);
      expect(result.pains).toEqual([]);
    }
  });

  it("점수가 높은 순으로 정렬하고 limit·kinds를 지킨다", async () => {
    const result = await searchSite("실험", { limit: 3 });
    expect(result.research).toHaveLength(3);
    expect(result.pains).toHaveLength(3);
    const scores = result.research.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const onlyPains = await searchSite("실험", { kinds: ["pain"] });
    expect(onlyPains.research).toEqual([]);
    expect(onlyPains.pains.length).toBeGreaterThan(0);
  });

  it("검색어는 최대 6단어까지만 쓴다", () => {
    expect(tokenizeQuery("a b, c  d e f g h")).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(tokenizeQuery("음향  음향,블랙홀")).toEqual(["음향", "블랙홀"]);
  });

  it("SQL 인젝션 문자열은 그냥 검색어로 처리된다 (파라미터 바인딩)", async () => {
    const before = await prisma.research.count();
    for (const q of [
      `'; DROP TABLE "Research"; --`,
      `음향' OR '1'='1`,
      `%' OR 1=1 --`,
      `\\'; DELETE FROM "PainPost" WHERE ''='`,
      `$1 $$ ; SELECT pg_sleep(5)`,
      "%",
      "_____",
    ]) {
      const result = await searchSite(q);
      expect(result.research.length + result.pains.length, q).toBeLessThan(5);
    }
    expect(await prisma.research.count()).toBe(before);
    expect(await prisma.painPost.count()).toBe(60);
    // LIKE 와일드카드가 전체 일치로 번지지 않는다
    expect((await searchSite("%")).research).toEqual([]);
    expect((await searchSite("_____")).research).toEqual([]);
  });

  it("색인은 DB 트리거가 관리한다: 수정·삭제가 검색에 바로 반영된다", async () => {
    const user = await createUser();
    const post = await prisma.painPost.create({
      data: { authorId: user.id, title: "토카막 플라스마 가둠 실패", body: "자기장 코일 전류가 불안정합니다" },
    });
    expect((await searchSite("토카막")).pains.map((p) => p.id)).toEqual([post.id]);
    await prisma.painPost.update({ where: { id: post.id }, data: { title: "스텔러레이터 설계 고민" } });
    expect((await searchSite("토카막")).pains).toEqual([]);
    expect((await searchSite("스텔러레이터")).pains.map((p) => p.id)).toEqual([post.id]);
    await prisma.painPost.delete({ where: { id: post.id } });
    expect((await searchSite("스텔러레이터")).pains).toEqual([]);
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("recommendByKeywords: 키워드 중 하나라도 관련 있으면 추천한다", async () => {
    const rec = await recommendByKeywords(["미세먼지", "없는키워드zzz", "PID 제어"], { limit: 5 });
    const titles = rec.research.map((r) => r.title);
    expect(titles.some((t) => t.includes("미세먼지"))).toBe(true);
    expect(titles.some((t) => t.includes("PID 제어"))).toBe(true);
    expect((await recommendByKeywords([])).research).toEqual([]);
    expect((await recommendByKeywords(["없는키워드zzz"])).research).toEqual([]);
  });

  it("findSimilarResearch: 자기 자신은 빼고 비슷한 연구를 준다", async () => {
    const egg = await prisma.research.findFirstOrThrow({ where: { title: { contains: "달걀 껍데기" } } });
    const similar = await findSimilarResearch(egg);
    expect(similar.map((s) => s.id)).not.toContain(egg.id);
    expect(similar.some((s) => s.title.includes("바이오차"))).toBe(true); // 둘 다 '흡착'
  });

  it("GET /api/search: 비로그인으로 검색할 수 있고 q가 없으면 400", async () => {
    const res = await GET(jsonRequest("GET", `/api/search?q=${encodeURIComponent("음향블랙홀")}&limit=2`), {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.research[0].title).toBe(ABH);
    expect(data.pains.length).toBeLessThanOrEqual(2);

    const bad = await GET(jsonRequest("GET", "/api/search"), {});
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("VALIDATION_ERROR");
    expect((await GET(jsonRequest("GET", "/api/search?q=a&limit=999"), {})).status).toBe(400);
  });
});

describe("searchSite: 하이브리드 (가짜 임베딩 제공자)", () => {
  const fake = new FakeEmbeddingProvider();

  beforeAll(async () => {
    await resetDb();
    await seedResearchAndPains(prisma);
  });

  it("임베딩이 저장되지 않은 상태에서도 hybrid 모드가 trigram 결과를 그대로 준다", async () => {
    const result = await searchSite("음향 블랙홀", { embeddingProvider: fake });
    expect(result.mode).toBe("hybrid");
    expect(result.research[0]).toMatchObject({ title: ABH, score: 1 });
  });

  it("backfillEmbeddings 후에는 두 점수를 가중 합산한다", async () => {
    expect(await backfillEmbeddings(fake)).toEqual({ research: 30, pain: 60 });
    expect(await backfillEmbeddings(fake)).toEqual({ research: 0, pain: 0 });
    const lexical = await searchSite("음향 블랙홀", { embeddingProvider: null });
    const hybrid = await searchSite("음향 블랙홀", { embeddingProvider: fake });
    expect(hybrid.mode).toBe("hybrid");
    expect(hybrid.research[0].title).toBe(ABH);
    // trigram 1.0 × 0.6 + 벡터(<1) × 0.4
    expect(hybrid.research[0].score).toBeLessThan(lexical.research[0].score);
    expect(hybrid.research[0].score).toBeGreaterThan(0.6);
  });

  it("trigram으로 못 찾아도 벡터가 충분히 가까우면 결과에 포함된다", async () => {
    const target = await prisma.research.findFirstOrThrow({ where: { title: ABH } });
    const text = [target.title, target.keywords.join(", "), target.summary, target.limitations].join("\n");
    const exact: EmbeddingProvider = { name: "stub", dimensions: 64, embed: async () => fake.embed([text]) };
    const result = await searchSite("zzzz", { embeddingProvider: exact, kinds: ["research"] });
    expect(result.research[0]).toMatchObject({ id: target.id, score: 0.4 });
    // 가깝지 않은 벡터만 있으면 여전히 "없음"
    const far = await searchSite("zzzz", { embeddingProvider: fake });
    expect(far.research).toEqual([]);
    expect(far.pains).toEqual([]);
  });

  it("차원이 다른 제공자로 바꿔도 오류 없이 trigram 점수로 동작한다", async () => {
    const result = await searchSite("음향 블랙홀", { embeddingProvider: new FakeEmbeddingProvider(8) });
    expect(result.research[0]).toMatchObject({ title: ABH, score: 1 });
  });

  it("임베딩 호출이 실패하면 trigram 결과로 대체한다", async () => {
    const broken: EmbeddingProvider = {
      name: "broken",
      dimensions: 64,
      embed: async () => {
        throw new Error("down");
      },
    };
    const result = await searchSite("음향 블랙홀", { embeddingProvider: broken });
    expect(result.mode).toBe("trigram");
    expect(result.research[0]).toMatchObject({ title: ABH, score: 1 });
  });
});

describe("검색 성능 (SPEC 9장: 1만 건 기준 1초 이내)", () => {
  beforeAll(async () => {
    await resetDb();
    await seedResearchAndPains(prisma);
    const user = await createUser();
    // 시드 고충의 제목·본문을 섞어 1만 건으로 불린다.
    await prisma.$executeRaw`
      INSERT INTO "PainPost" ("id", "authorId", "title", "body", "tags", "updatedAt")
      SELECT 'bulk' || g, ${user.id},
        (SELECT title FROM "PainPost" WHERE id NOT LIKE 'bulk%' ORDER BY md5(id || g::text) LIMIT 1),
        (SELECT string_agg(body, ' ') FROM (SELECT body FROM "PainPost" WHERE id NOT LIKE 'bulk%' ORDER BY md5(g::text || id) LIMIT 3) b),
        ARRAY[]::text[], now()
      FROM generate_series(1, 9910) g`;
    await prisma.$executeRawUnsafe(`ANALYZE "SearchDocument"`);
  }, 120_000);

  it("색인 1만 건에서 여러 유형의 검색이 모두 1초 안에 끝난다", async () => {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "SearchDocument"`;
    expect(Number(rows[0].n)).toBe(10_000);
    await searchSite("준비"); // 연결 준비
    const timings: string[] = [];
    for (const q of ["음향 블랙홀", "음향블랙홀 진동감쇠", "미새먼지", "실험", "양자 컴퓨터", "스마트폰 실험 소음 공명 측정 오차"]) {
      const started = performance.now();
      await searchSite(q);
      const ms = performance.now() - started;
      timings.push(`${q}: ${ms.toFixed(0)}ms`);
      expect(ms, q).toBeLessThan(1000);
    }
    console.info(`검색 시간(1만 건): ${timings.join(", ")}`);
  }, 60_000);
});
