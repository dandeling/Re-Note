// `pnpm db:seed`: 연구 30건·고충 60건 (P6-7). 서식 프리셋 3종 (P2-5).
// 여러 번 실행해도 같은 결과가 되도록 시드 계정(seed-*@example.com)의 데이터만 지우고 다시 만든다.
import "dotenv/config";
import { prisma } from "@/lib/db";
import { backfillEmbeddings } from "@/lib/search";
import { ensureFormatPresets } from "@/server/format-templates";
import { seedResearchAndPains } from "./seed-research";

async function main() {
  await ensureFormatPresets();
  const counts = await seedResearchAndPains(prisma);
  // EMBEDDING_PROVIDER가 설정된 경우에만 임베딩을 채운다 (없으면 trigram 검색만 사용).
  const embedded = await backfillEmbeddings();
  console.log(`seed: 연구 ${counts.research}건, 고충 ${counts.pains}건 (임베딩 연구 ${embedded.research}건, 고충 ${embedded.pain}건)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
