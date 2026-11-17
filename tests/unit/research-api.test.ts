import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/research/route";
import { GET } from "@/app/api/research/[id]/route";
import { prisma } from "@/lib/db";
import { searchSite } from "@/lib/search";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

async function publish(body: Record<string, unknown>) {
  const res = await POST(jsonRequest("POST", "/api/research", body), {});
  return { res, data: await res.json() };
}

async function getResearch(id: string) {
  const res = await GET(jsonRequest("GET", `/api/research/${id}`), ctx({ id }));
  return { res, data: await res.json() };
}

const base = {
  title: "음향 블랙홀 판의 진동 감쇠",
  summary: "알루미늄 판에 음향 블랙홀 홈을 가공해 굽힘파 진동 감쇠를 측정했다.",
  field: "물리",
  keywords: ["음향 블랙홀", "진동 감쇠"],
  limitations: "저주파에서는 효과가 작았다.",
};

describe("연구 공개 API (P6-1)", () => {
  let owner: Awaited<ReturnType<typeof createUser>>;
  let other: Awaited<ReturnType<typeof createUser>>;
  let projectId: string;

  beforeEach(async () => {
    await resetDb();
    owner = await createUser("소유자");
    other = await createUser("다른 사람");
    projectId = (await prisma.project.create({ data: { ownerId: owner.id, title: "내 프로젝트" } })).id;
    loginAs(owner);
  });

  it("비로그인은 공개할 수 없다 (401)", async () => {
    loginAs(null);
    expect((await publish({ ...base, projectId })).res.status).toBe(401);
    expect(await prisma.research.count()).toBe(0);
  });

  it("본인 프로젝트를 공개하면 Research가 생기고 바로 검색된다", async () => {
    const { res, data } = await publish({ ...base, projectId, keywords: ["음향 블랙홀", "음향 블랙홀", "진동 감쇠"] });
    expect(res.status).toBe(201);
    expect(data.research).toMatchObject({ title: base.title, keywords: ["음향 블랙홀", "진동 감쇠"], report: null });
    const row = await prisma.research.findUniqueOrThrow({ where: { id: data.research.id } });
    expect(row).toMatchObject({ projectId, authorId: owner.id, reportAssetId: null });
    expect((await searchSite("음향블랙홀")).research.map((r) => r.id)).toEqual([data.research.id]);
  });

  it("남의 프로젝트·휴지통의 프로젝트·없는 프로젝트는 404", async () => {
    const theirs = await prisma.project.create({ data: { ownerId: other.id, title: "남의 것" } });
    const trashed = await prisma.project.create({ data: { ownerId: owner.id, title: "버린 것", deletedAt: new Date() } });
    for (const id of [theirs.id, trashed.id, "nope"]) {
      const { res, data } = await publish({ ...base, projectId: id });
      expect(res.status, id).toBe(404);
      expect(data.error.code).toBe("NOT_FOUND");
    }
    expect(await prisma.research.count()).toBe(0);
  });

  it("요약·키워드가 없으면 400", async () => {
    for (const body of [
      { ...base, projectId, summary: "  " },
      { ...base, projectId, keywords: [] },
      { ...base, projectId, title: "" },
      { ...base },
    ]) {
      const { res, data } = await publish(body);
      expect(res.status).toBe(400);
      expect(data.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("결과보고서는 본인 소유의 PDF 자산만 연결된다", async () => {
    const mine = await prisma.asset.create({
      data: { ownerId: owner.id, projectId, kind: "PDF", storageKey: "k/mine.pdf", filename: "보고서.pdf", size: 1000, mime: "application/pdf" },
    });
    const theirs = await prisma.asset.create({
      data: { ownerId: other.id, kind: "PDF", storageKey: "k/theirs.pdf", filename: "남.pdf", size: 1, mime: "application/pdf" },
    });
    const image = await prisma.asset.create({
      data: { ownerId: owner.id, kind: "IMAGE", storageKey: "k/a.png", filename: "a.png", size: 1, mime: "image/png" },
    });
    const deleted = await prisma.asset.create({
      data: { ownerId: owner.id, kind: "PDF", storageKey: "k/d.pdf", filename: "d.pdf", size: 1, mime: "application/pdf", deletedAt: new Date() },
    });
    for (const id of [theirs.id, image.id, deleted.id, "nope"]) {
      const { res } = await publish({ ...base, projectId, reportAssetId: id });
      expect(res.status, id).toBe(400);
    }
    const { res, data } = await publish({ ...base, projectId, reportAssetId: mine.id });
    expect(res.status).toBe(201);
    expect(data.research.report).toEqual({ assetId: mine.id, filename: "보고서.pdf", size: 1000 });
  });

  it("GET /api/research/:id: 비로그인도 볼 수 있고, 연결된 고충은 제목·링크만 (작성자 정보 없음, 익명 글 제외)", async () => {
    const { data } = await publish({ ...base, projectId });
    const id = data.research.id;
    const named = await prisma.painPost.create({
      data: { authorId: other.id, researchId: id, title: "실명 고충", body: "본문" },
    });
    await prisma.painPost.create({
      data: { authorId: other.id, researchId: id, title: "익명 고충", body: "본문", isAnonymous: true },
    });
    await prisma.painPost.create({ data: { authorId: owner.id, title: "연결 안 된 고충", body: "본문" } });

    loginAs(null);
    const { res, data: detail } = await getResearch(id);
    expect(res.status).toBe(200);
    expect(detail.research).toMatchObject({ id, summary: base.summary, limitations: base.limitations, report: null });
    expect(detail.research.pains).toHaveLength(1);
    expect(detail.research.pains[0]).toMatchObject({ id: named.id, title: "실명 고충", path: `/pains/${named.id}` });
    const text = JSON.stringify(detail);
    expect(text).not.toMatch(/author|email|소유자|다른 사람|익명 고충/);
    expect(text).not.toContain(other.id);
    expect(text).not.toContain(owner.id);

    // 검색 결과도 같은 규칙: 고충 수에 익명 글을 세지 않고, 익명 글 검색 결과에는 연결된 연구를 싣지 않는다.
    const found = await searchSite("익명 고충");
    expect(found.pains.find((p) => p.title === "익명 고충")?.researchId).toBeNull();
    expect((await searchSite("실명 고충")).pains.find((p) => p.title === "실명 고충")?.researchId).toBe(id);
    expect((await searchSite("음향블랙홀")).research.find((r) => r.id === id)?.painCount).toBe(1);
  });

  it("GET /api/research/:id: 없는 연구는 404", async () => {
    const { res, data } = await getResearch("nope");
    expect(res.status).toBe(404);
    expect(data.error.code).toBe("NOT_FOUND");
  });
});
