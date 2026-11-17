import "dotenv/config";
import { prisma } from "@/lib/db";
import { FORMAT_PRESETS } from "@/lib/format/presets";
import { ensureFormatPresets } from "@/server/format-templates";

/** 서식 프리셋 3종 시드 (P2-5). 고정 id로 upsert하므로 여러 번 실행해도 된다. */
export async function seedFormatPresets() {
  await ensureFormatPresets();
  console.log(`seed: 서식 프리셋 ${FORMAT_PRESETS.length}종 (${FORMAT_PRESETS.map((p) => p.name).join(", ")})`);
  await prisma.$disconnect();
}
