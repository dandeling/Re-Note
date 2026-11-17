// 아티팩트 db용 예시 데이터(연구 30건·고충 60건)를 prisma/seed-data.ts에서 만든다: npx tsx artifact/make-seed.ts
import { writeFileSync } from "node:fs";
import { SEED_RESEARCH } from "../prisma/seed-data";

const base = Date.UTC(2026, 8, 1);
const DAY = 86400000;
const docs: Record<string, unknown> = {};
let p = 0;
SEED_RESEARCH.forEach((r, i) => {
  const rid = `seed-r${String(i + 1).padStart(2, "0")}`;
  docs[`research/${rid}`] = {
    title: r.title, summary: r.summary, field: r.field, keywords: r.keywords, limitations: r.limitations,
    authorId: null, publishedAt: base + i * DAY, report: null, isExample: true,
  };
  r.pains.forEach((pain, j) => {
    p += 1;
    const anonymous = Boolean(pain.anonymous);
    const linked = pain.linked !== false && !anonymous; // 익명 글은 연구에 연결하지 않는다
    const createdAt = base + i * DAY + (j + 1) * 3600000;
    docs[`pains/seed-p${String(p).padStart(3, "0")}`] = {
      title: pain.title, body: pain.body, stage: pain.stage, field: r.field, tags: pain.tags,
      isAnonymous: anonymous, authorId: null, researchId: linked ? rid : null,
      resolved: Boolean(pain.resolution), resolution: pain.resolution ?? null,
      createdAt, updatedAt: createdAt, meTooCount: 0, commentCount: 0, isExample: true,
    };
  });
});
writeFileSync(new URL("./dev-seed.json", import.meta.url), JSON.stringify(docs, null, 1));
console.log(Object.keys(docs).length, "docs");
