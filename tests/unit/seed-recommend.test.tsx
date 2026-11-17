import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { ProjectRecommendations } from "@/components/research/project-recommendations";
import { prisma } from "@/lib/db";
import { messages } from "@/lib/messages";
import { SEED_RESEARCH } from "@/prisma/seed-data";
import { seedResearchAndPains } from "@/prisma/seed-research";
import { resetDb } from "../setup/db";

const t = messages.research;

async function renderRecommend(keywords: string[]) {
  return renderToStaticMarkup(await ProjectRecommendations({ keywords }));
}

// P6-7: 시드 데이터 + 프로젝트 홈 "내 키워드와 관련된 연구·고충"
describe("시드 데이터", () => {
  beforeAll(async () => {
    await resetDb();
  });

  it("연구 30건·고충 60건을 만들고, 다시 실행해도 같은 결과다", async () => {
    expect(await seedResearchAndPains(prisma)).toEqual({ research: 30, pains: 60 });
    expect(await seedResearchAndPains(prisma)).toEqual({ research: 30, pains: 60 });
    expect(await prisma.research.count()).toBe(30);
    expect(await prisma.painPost.count()).toBe(60);
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "SearchDocument"`;
    expect(Number(rows[0].n)).toBe(90);
  });

  it("분야·키워드가 다양하고, 익명·해결·연구 미연결 고충이 섞여 있다", async () => {
    expect(new Set(SEED_RESEARCH.map((r) => r.title)).size).toBe(30);
    expect(new Set(SEED_RESEARCH.map((r) => r.field)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(SEED_RESEARCH.flatMap((r) => r.keywords)).size).toBeGreaterThanOrEqual(80);
    expect(await prisma.painPost.count({ where: { isAnonymous: true } })).toBeGreaterThan(0);
    expect(await prisma.painPost.count({ where: { resolved: true } })).toBeGreaterThan(0);
    expect(await prisma.painPost.count({ where: { researchId: null } })).toBeGreaterThan(0);
    // 익명 글은 공개 연구에 연결하지 않는다 (decisions pains-5)
    expect(await prisma.painPost.count({ where: { isAnonymous: true, researchId: { not: null } } })).toBe(0);
  });
});

describe("프로젝트 홈 추천", () => {
  beforeAll(async () => {
    await resetDb();
    await seedResearchAndPains(prisma);
  });

  it("프로젝트 키워드와 관련된 연구·고충을 보여 준다", async () => {
    const html = await renderRecommend(["진동 감쇠", "가속도 센서"]);
    expect(html).toContain(t.recommendHeading);
    expect(html).toContain(t.recommendResearch);
    expect(html).toContain("음향 블랙홀 구조를 이용한 얇은 판의 진동 감쇠 효과 측정");
    expect(html).toContain(t.recommendPains);
    expect(html).toContain("가속도 센서 무게 때문에 진동 측정값이 달라지는 문제");
  });

  it("키워드가 없으면 키워드를 넣으라고 안내하고, 관련 글이 없으면 없다고 표시한다", async () => {
    expect(await renderRecommend([])).toContain(t.recommendNoKeywords);
    const html = await renderRecommend(["초전도체", "블록체인"]);
    expect(html).toContain(t.recommendEmpty);
    expect(html).not.toContain('data-testid="research-card"');
  });
});
