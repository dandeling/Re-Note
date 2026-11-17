import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { log } from "@/lib/log";
import { getEmbeddingProvider, toVectorLiteral, type EmbeddingProvider } from "@/lib/search/embedding";

/**
 * 임베딩 저장 (SPEC 7.2-2). trigram 색인(`SearchDocument`)은 DB 트리거가 자동으로 관리하므로
 * 여기서는 선택 사항인 pgvector 임베딩만 다룬다. 제공자가 없으면 아무 일도 하지 않는다.
 */

type Kind = "research" | "pain";

const TABLE: Record<Kind, Prisma.Sql> = {
  research: Prisma.sql`"Research"`,
  pain: Prisma.sql`"PainPost"`,
};

const MAX_EMBED_CHARS = 4000;

async function embeddingTexts(kind: Kind, ids: string[]): Promise<{ id: string; text: string }[]> {
  if (kind === "research") {
    const rows = await prisma.research.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, keywords: true, summary: true, limitations: true },
    });
    return rows.map((r) => ({
      id: r.id,
      text: [r.title, r.keywords.join(", "), r.summary, r.limitations].join("\n").slice(0, MAX_EMBED_CHARS),
    }));
  }
  const rows = await prisma.painPost.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, tags: true, body: true, resolution: true },
  });
  return rows.map((p) => ({
    id: p.id,
    text: [p.title, p.tags.join(", "), p.body, p.resolution ?? ""].join("\n").slice(0, MAX_EMBED_CHARS),
  }));
}

async function embedAndStore(kind: Kind, ids: string[], provider: EmbeddingProvider): Promise<number> {
  const docs = await embeddingTexts(kind, ids);
  if (docs.length === 0) return 0;
  const vectors = await provider.embed(docs.map((d) => d.text));
  for (const [i, doc] of docs.entries()) {
    await prisma.$executeRaw`UPDATE ${TABLE[kind]} SET "embedding" = ${toVectorLiteral(vectors[i])}::vector WHERE "id" = ${doc.id}`;
  }
  return docs.length;
}

/**
 * 연구·고충 하나의 임베딩을 계산해 저장한다. 글을 만들거나 고친 뒤 호출한다.
 * 실패해도 예외를 던지지 않는다(검색은 trigram만으로도 동작한다).
 */
export async function indexEmbedding(
  kind: Kind,
  id: string,
  provider: EmbeddingProvider | null = getEmbeddingProvider(),
): Promise<boolean> {
  if (!provider) return false;
  try {
    return (await embedAndStore(kind, [id], provider)) > 0;
  } catch (err) {
    log.warn("search.embedding_index_failed", { kind, id, provider: provider.name, error: String(err) });
    return false;
  }
}

/** 임베딩이 없는 행을 채운다 (시드, 제공자를 나중에 설정한 경우). */
export async function backfillEmbeddings(
  provider: EmbeddingProvider | null = getEmbeddingProvider(),
  batchSize = 50,
): Promise<{ research: number; pain: number }> {
  const done = { research: 0, pain: 0 };
  if (!provider) return done;
  for (const kind of ["research", "pain"] as const) {
    for (;;) {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM ${TABLE[kind]} WHERE "embedding" IS NULL ORDER BY "id" LIMIT ${batchSize}`;
      if (rows.length === 0) break;
      const stored = await embedAndStore(kind, rows.map((r) => r.id), provider);
      done[kind] += stored;
      if (stored < rows.length) break;
    }
  }
  return done;
}
