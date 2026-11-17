import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import ResearchPage from "@/app/research/[id]/page";
import { prisma } from "@/lib/db";
import { messages } from "@/lib/messages";
import { seedResearchAndPains } from "@/prisma/seed-research";
import { SEED_AUTHORS } from "@/prisma/seed-data";
import { createUser, resetDb } from "../setup/db";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

const t = messages.research;

async function renderResearch(id: string) {
  const element = await ResearchPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  } as PageProps<"/research/[id]">);
  return renderToStaticMarkup(element);
}

// SPEC 7.2 완료 기준: 연구 상세에서 고충·한계·결과보고서를 한 화면에서 볼 수 있다 (P6-6)
describe("/research/[id] 연구 상세", () => {
  beforeAll(async () => {
    await resetDb();
    await seedResearchAndPains(prisma);
  });

  it("요약·한계·연결된 고충·결과보고서 영역·비슷한 연구를 한 화면에 보여 준다 (비로그인)", async () => {
    const r = await prisma.research.findFirstOrThrow({ where: { title: { startsWith: "음향 블랙홀" } } });
    const html = await renderResearch(r.id);
    expect(html).toContain(r.title);
    expect(html).toContain(t.summary);
    expect(html).toContain("점탄성 테이프"); // 요약
    expect(html).toContain(t.limitations);
    expect(html).toContain("저주파(500 Hz 이하)"); // 한계
    expect(html).toContain(t.pains.replace("{n}", "1"));
    expect(html).toContain("음향 블랙홀 홈을 CNC로 깎으면 끝부분이 찢어져요");
    const pains = await prisma.painPost.findMany({ where: { researchId: r.id } });
    for (const p of pains) expect(html).toContain(`href="/pains/${p.id}"`);
    expect(html).toContain(t.report);
    expect(html).toContain(t.noReport);
    expect(html).toContain(t.similar);
  });

  it("연결된 고충은 고충 목록(PainList)으로 보여 주고, 익명 글은 연구별 목록에서 빠진다", async () => {
    const owner = await createUser("연구자");
    const r = await prisma.research.create({
      data: { authorId: owner.id, title: "고충 목록 확인용 연구", summary: "요약", keywords: ["고충목록"] },
    });
    const named = await prisma.painPost.create({
      data: { authorId: owner.id, researchId: r.id, title: "실명 고충", body: "**센서**가 무거워요", stage: "EXPERIMENT", tags: ["센서"] },
    });
    // 예전 데이터나 직접 넣은 행처럼 익명 글이 연구를 가리키고 있어도 보여 주지 않는다.
    const anonymous = await prisma.painPost.create({
      data: { authorId: owner.id, researchId: r.id, title: "익명 고충", body: "본문", isAnonymous: true },
    });
    const html = await renderResearch(r.id);
    expect(html).toContain(t.pains.replace("{n}", "1"));
    expect(html).toContain(`href="/pains/${named.id}"`);
    expect(html).toContain(messages.pains.stages.EXPERIMENT); // 단계 배지
    expect(html).toContain("#센서"); // 태그
    expect(html).toContain("센서가 무거워요"); // 마크다운 기호를 걷어 낸 요약
    expect(html).not.toContain("**센서**");
    expect(html).not.toContain(anonymous.title);
    expect(html).not.toContain(`/pains/${anonymous.id}`);
    expect(html).not.toContain(owner.email);
    expect(html).not.toContain(owner.id);
  });

  it("시드의 익명 고충과 작성자 이메일은 연구 상세에 나오지 않는다", async () => {
    const anonymous = await prisma.painPost.findMany({ where: { isAnonymous: true } });
    expect(anonymous.length).toBeGreaterThan(0);
    for (const r of await prisma.research.findMany({ where: { authorId: { in: anonymous.map((p) => p.authorId) } }, take: 5 })) {
      const html = await renderResearch(r.id);
      for (const p of anonymous) expect(html).not.toContain(`/pains/${p.id}`);
      for (const a of SEED_AUTHORS) expect(html).not.toContain(a.email);
    }
  });

  it("비슷한 연구에는 자기 자신이 없고, 있으면 카드로 보여 준다", async () => {
    const egg = await prisma.research.findFirstOrThrow({ where: { title: { contains: "달걀 껍데기" } } });
    const html = await renderResearch(egg.id);
    const similarPart = html.slice(html.indexOf(t.similar));
    expect(similarPart).toContain('data-testid="research-card"');
    expect(similarPart).toContain("바이오차");
    expect(similarPart).not.toContain(`href="/research/${egg.id}"`);
  });

  it("결과보고서가 연결돼 있으면 PDF 인라인 뷰어와 다운로드 링크를 보여 준다", async () => {
    const owner = await createUser();
    const asset = await prisma.asset.create({
      data: { ownerId: owner.id, kind: "PDF", storageKey: "k/report.pdf", filename: "결과보고서.pdf", size: 10, mime: "application/pdf" },
    });
    const r = await prisma.research.create({
      data: { authorId: owner.id, title: "보고서가 있는 연구", summary: "요약", keywords: ["테스트"], reportAssetId: asset.id },
    });
    const html = await renderResearch(r.id);
    expect(html).toContain("<iframe");
    expect(html).toContain(`title="${t.reportViewerTitle}"`);
    expect(html).toContain('download="결과보고서.pdf"');
    expect(html).toContain(t.download);
    expect(html).toContain(t.noPains);
    expect(html).toContain(t.noLimitations);
  });

  it("없는 연구는 404", async () => {
    await expect(renderResearch("nope")).rejects.toThrow();
  });
});
