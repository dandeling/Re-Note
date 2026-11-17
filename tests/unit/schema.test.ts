import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createUser, resetDb } from "../setup/db";

describe("Prisma 스키마 (SPEC 6장)", () => {
  beforeEach(resetDb);

  it("pg_trgm, vector 확장이 설치되어 있다", async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension`;
    const names = rows.map((r) => r.extname);
    expect(names).toContain("pg_trgm");
    expect(names).toContain("vector");
  });

  it("프로젝트는 기본 비공개이고 문서 버전은 1에서 시작한다", async () => {
    const user = await createUser();
    const project = await prisma.project.create({
      data: { ownerId: user.id, title: "음향 블랙홀", keywords: ["진동", "감쇠"] },
    });
    expect(project.visibility).toBe("PRIVATE");
    const doc = await prisma.document.create({
      data: { projectId: project.id, title: "보고서", contentJson: { type: "doc", content: [] } },
    });
    expect(doc.version).toBe(1);
  });

  it("(painPostId, userId) 반응은 유일하다", async () => {
    const user = await createUser();
    const post = await prisma.painPost.create({
      data: { authorId: user.id, title: "센서 노이즈", body: "측정값이 흔들려요" },
    });
    await prisma.reaction.create({ data: { painPostId: post.id, userId: user.id } });
    await expect(
      prisma.reaction.create({ data: { painPostId: post.id, userId: user.id } }),
    ).rejects.toThrow();
  });

  it("trigram 유사도 함수를 한국어에 쓸 수 있다", async () => {
    const rows = await prisma.$queryRaw<{ s: number }[]>`
      SELECT similarity('음향 블랙홀 진동 감쇠', '음향블랙홀 진동감쇠') AS s`;
    expect(rows[0].s).toBeGreaterThan(0.3);
  });
});
