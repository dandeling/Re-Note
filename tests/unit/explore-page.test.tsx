import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import ExplorePage from "@/app/explore/page";
import { ExploreResults } from "@/components/research/explore-results";
import { prisma } from "@/lib/db";
import { messages } from "@/lib/messages";
import type { SiteSearchResult } from "@/lib/search";
import { seedResearchAndPains } from "@/prisma/seed-research";
import { resetDb } from "../setup/db";

const t = messages.explore;

async function renderExplore(q?: string) {
  const element = await ExplorePage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(q === undefined ? {} : { q }),
  } as PageProps<"/explore">);
  return renderToStaticMarkup(element);
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

// SPEC 7.2 결과 화면 (P6-4)
describe("/explore 결과 화면", () => {
  beforeAll(async () => {
    await resetDb();
    await seedResearchAndPains(prisma);
  });

  it("검색어가 없으면 안내 문구만 보여 준다", async () => {
    const html = await renderExplore();
    expect(html).toContain(t.promptEmpty);
    expect(html).not.toContain('data-testid="research-card"');
    expect(html).not.toContain(t.noResearch);
  });

  it("유사 연구가 있으면 연구 카드(제목·요약·키워드·유사도)와 배지(고충 N건·한계·결과보고서 유무)를 보여 준다", async () => {
    const html = await renderExplore("음향 블랙홀");
    expect(html).toContain('data-testid="research-card"');
    expect(html).toContain("음향 블랙홀 구조를 이용한 얇은 판의 진동 감쇠 효과 측정");
    expect(html).toMatch(/href="\/research\/[^"]+"/);
    expect(html).toContain("알루미늄 판"); // 요약
    expect(html).toContain("굽힘파"); // 키워드
    expect(html).toContain(t.similarity.replace("{p}", "100"));
    expect(html).toContain(t.painCount.replace("{n}", "1")); // 익명 고충은 연구에 연결하지 않는다(시드)
    expect(html).toContain("한계: 홈 끝 두께");
    expect(html).toContain(t.noReport);
    expect(html).not.toContain(t.noResearch);
    // 관련 고충도 함께
    expect(html).toContain(t.relatedPainsHeading.split("{n}")[0]);
    expect(html).toMatch(/href="\/pains\/[^"]+"/);
  });

  it("유사 연구가 없으면 '아직 이 사이트에 등록된 연구가 없어요'를 분명히 표시한다", async () => {
    const html = await renderExplore("초전도체 마이스너 효과");
    expect(html).toContain(t.noResearch);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('data-testid="research-card"');
    expect(html).toContain(t.noPains);
  });

  it("연구는 없고 관련 고충만 있으면 고충을 따로 노출한다", async () => {
    // "화이트밸런스"는 고충 본문에만 있는 단어다.
    const html = await renderExplore("화이트밸런스");
    expect(html).toContain(t.noResearch);
    expect(html).toContain('data-testid="pain-hits"');
    expect(html).toContain(t.relatedPainsOnlyHeading.split("{n}")[0]);
    expect(html).not.toContain(t.noPains);
  });

  it("결과보고서가 있는 연구는 '결과보고서 있음' 배지, 작성자 정보는 표시하지 않는다", () => {
    const result: SiteSearchResult = {
      query: "x",
      mode: "trigram",
      research: [
        {
          type: "research",
          id: "r1",
          title: "보고서 있는 연구",
          summary: "요약",
          field: "화학",
          keywords: ["흡착"],
          limitations: "",
          painCount: 0,
          hasReport: true,
          score: 0.734,
          path: "/research/r1",
        },
      ],
      pains: [],
    };
    const html = renderToStaticMarkup(<ExploreResults result={result} />);
    expect(html).toContain(t.hasReport);
    expect(html).toContain(t.noLimitations);
    expect(html).toContain(t.painCount.replace("{n}", "0"));
    expect(html).toContain(t.similarity.replace("{p}", "73"));
    expect(count(html, 'data-testid="research-card"')).toBe(1);
  });
});
