import http from "node:http";
import https from "node:https";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/search/route";
import { prisma } from "@/lib/db";
import { FakeEmbeddingProvider, findSimilarResearch, recommendByKeywords, searchSite } from "@/lib/search";
import { seedResearchAndPains } from "@/prisma/seed-research";
import { resetDb } from "../setup/db";
import { jsonRequest } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

// SPEC 7.2 완료 기준: 키워드 검색 결과가 사이트 내부 데이터만으로 구성된다 (외부 호출 없음)
describe("검색은 외부 서비스를 호출하지 않는다", () => {
  beforeAll(async () => {
    await resetDb();
    await seedResearchAndPains(prisma);
  });
  afterEach(() => vi.restoreAllMocks());

  function watchNetwork() {
    const fail = (name: string) => () => {
      throw new Error(`검색 중 외부 호출 발생: ${name}`);
    };
    return [
      vi.spyOn(globalThis, "fetch").mockImplementation(fail("fetch")),
      vi.spyOn(http, "request").mockImplementation(fail("http.request")),
      vi.spyOn(http, "get").mockImplementation(fail("http.get")),
      vi.spyOn(https, "request").mockImplementation(fail("https.request")),
      vi.spyOn(https, "get").mockImplementation(fail("https.get")),
    ];
  }

  it("searchSite·추천·API 모두 fetch/http 호출 없이 결과를 만든다", async () => {
    const spies = watchNetwork();

    const found = await searchSite("음향 블랙홀 진동 감쇠");
    expect(found.research.length).toBeGreaterThan(0);
    const none = await searchSite("초전도체 마이스너 효과");
    expect(none.research).toEqual([]);
    expect(none.pains).toEqual([]);
    await recommendByKeywords(["미세먼지", "환기"]);
    await findSimilarResearch({ id: found.research[0].id, title: found.research[0].title, keywords: found.research[0].keywords });
    const res = await GET(jsonRequest("GET", `/api/search?q=${encodeURIComponent("바이오디젤")}`), {});
    expect(res.status).toBe(200);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("모든 결과는 이 사이트 DB에 실제로 있는 연구·고충이다", async () => {
    const spies = watchNetwork();
    for (const q of ["실험", "센서 보정", "설문 조사", "흡착", "PID 제어"]) {
      const result = await searchSite(q, { limit: 20 });
      const research = await prisma.research.findMany({ where: { id: { in: result.research.map((r) => r.id) } } });
      const pains = await prisma.painPost.findMany({ where: { id: { in: result.pains.map((p) => p.id) } } });
      expect(research).toHaveLength(result.research.length);
      expect(pains).toHaveLength(result.pains.length);
      for (const hit of result.research) {
        expect(research.find((r) => r.id === hit.id)?.title).toBe(hit.title);
        expect(hit.path).toBe(`/research/${hit.id}`);
      }
      for (const hit of result.pains) {
        expect(pains.find((p) => p.id === hit.id)?.title).toBe(hit.title);
        expect(hit.path).toBe(`/pains/${hit.id}`);
      }
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("하이브리드 모드에서도 호출되는 것은 주입된 임베딩 제공자뿐이다", async () => {
    const spies = watchNetwork();
    const provider = new FakeEmbeddingProvider();
    const embed = vi.spyOn(provider, "embed");
    const result = await searchSite("음향 블랙홀", { embeddingProvider: provider });
    expect(result.mode).toBe("hybrid");
    expect(embed).toHaveBeenCalledTimes(1);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
