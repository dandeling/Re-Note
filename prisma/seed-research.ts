import type { PrismaClient } from "@/lib/generated/prisma/client";
import { SEED_AUTHORS, SEED_RESEARCH } from "./seed-data";

/**
 * 연구 30건·고충 60건 시드 (P6-7). 여러 번 실행해도 결과가 같도록
 * 시드 계정을 지우고(연구·고충이 함께 삭제됨) 다시 만든다.
 */
export async function seedResearchAndPains(prisma: PrismaClient) {
  await prisma.user.deleteMany({ where: { email: { in: SEED_AUTHORS.map((a) => a.email) } } });
  const authors = [];
  for (const a of SEED_AUTHORS) authors.push(await prisma.user.create({ data: a }));

  const base = Date.UTC(2026, 8, 1);
  const DAY = 24 * 60 * 60 * 1000;
  let painCount = 0;

  for (const [i, r] of SEED_RESEARCH.entries()) {
    const author = authors[i % authors.length];
    const research = await prisma.research.create({
      data: {
        authorId: author.id,
        title: r.title,
        summary: r.summary,
        field: r.field,
        keywords: r.keywords,
        limitations: r.limitations,
        publishedAt: new Date(base + i * 2 * DAY),
      },
    });
    for (const [j, p] of r.pains.entries()) {
      await prisma.painPost.create({
        data: {
          // 고충은 연구 작성자 본인 또는 다른 시드 계정이 쓴 것으로 섞는다.
          authorId: authors[(i + j) % authors.length].id,
          // 익명 글은 공개 연구에 연결하지 않는다 (decisions pains-5: 연구와 묶여 작성자가 드러나지 않게).
          researchId: p.linked === false || p.anonymous ? null : research.id,
          title: p.title,
          body: p.body,
          stage: p.stage,
          field: r.field,
          tags: p.tags,
          isAnonymous: p.anonymous ?? false,
          resolved: Boolean(p.resolution),
          resolution: p.resolution ?? null,
          createdAt: new Date(base + (i * 2 + j) * DAY - 5 * DAY),
        },
      });
      painCount += 1;
    }
  }
  return { research: SEED_RESEARCH.length, pains: painCount };
}
