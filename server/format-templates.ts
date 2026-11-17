import type { z } from "zod";
import { prisma } from "@/lib/db";
import { FORMAT_PRESETS } from "@/lib/format/presets";
import { DEFAULT_RULES, normalizeRules, type FormatRules } from "@/lib/format/rules";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { saveFormatTemplateSchema } from "@/lib/validation/format";
import { notFound } from "@/server/api";

export type FormatTemplateDto = { id: string; name: string; isPreset: boolean; rulesJson: FormatRules };

const toDto = (t: { id: string; name: string; isPreset: boolean; rulesJson: unknown }): FormatTemplateDto => ({
  id: t.id,
  name: t.name,
  isPreset: t.isPreset,
  // 저장된 규칙이 옛 모양이어도 항상 완전한 규칙으로 돌려준다.
  rulesJson: normalizeRules(t.rulesJson).rules,
});

/** 프리셋 3종을 DB에 넣는다(있으면 코드 상수로 갱신). 시드와 템플릿 조회가 같이 쓴다. */
export async function ensureFormatPresets() {
  for (const preset of FORMAT_PRESETS) {
    const data = { name: preset.name, rulesJson: preset.rules as Prisma.InputJsonValue, isPreset: true, ownerId: null };
    await prisma.formatTemplate.upsert({ where: { id: preset.id }, create: { id: preset.id, ...data }, update: data });
  }
}

/** 프리셋 + 내 템플릿 */
export async function listFormatTemplates(userId: string) {
  const presetIds = FORMAT_PRESETS.map((p) => p.id);
  let presets = await prisma.formatTemplate.findMany({ where: { id: { in: presetIds }, isPreset: true } });
  if (presets.length < presetIds.length) {
    // 시드를 돌리지 않은 DB에서도 프리셋을 쓸 수 있게 한다.
    await ensureFormatPresets();
    presets = await prisma.formatTemplate.findMany({ where: { id: { in: presetIds }, isPreset: true } });
  }
  presets.sort((a, b) => presetIds.indexOf(a.id) - presetIds.indexOf(b.id));
  const templates = await prisma.formatTemplate.findMany({
    where: { ownerId: userId, isPreset: false },
    orderBy: { createdAt: "desc" },
  });
  return { presets: presets.map(toDto), templates: templates.map(toDto) };
}

/** 내 템플릿 저장. id가 있으면 수정인데, 내 것이 아니거나 프리셋이면 404. */
export async function saveFormatTemplate(userId: string, input: z.infer<typeof saveFormatTemplateSchema>) {
  const data = { name: input.name, rulesJson: input.rulesJson as Prisma.InputJsonValue };
  if (input.id === undefined) {
    return { created: true, template: toDto(await prisma.formatTemplate.create({ data: { ...data, ownerId: userId } })) };
  }
  const result = await prisma.formatTemplate.updateMany({
    where: { id: input.id, ownerId: userId, isPreset: false },
    data,
  });
  if (result.count === 0) notFound();
  return { created: false, template: toDto(await prisma.formatTemplate.findUniqueOrThrow({ where: { id: input.id } })) };
}

/** 문서에 적용할 규칙. 템플릿이 없으면 기본 규칙(일반 보고서). */
export async function rulesForDocument(doc: { formatTemplateId: string | null }): Promise<FormatRules> {
  if (!doc.formatTemplateId) return DEFAULT_RULES;
  const template = await prisma.formatTemplate.findUnique({ where: { id: doc.formatTemplateId } });
  return template ? normalizeRules(template.rulesJson).rules : DEFAULT_RULES;
}
