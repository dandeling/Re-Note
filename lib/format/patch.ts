import { resolveFont } from "@/lib/format/fonts";
import { DEFAULT_RULES, normalizeRules, type FormatRules } from "@/lib/format/rules";

/** 서식 규칙의 일부 (AI가 자유 텍스트에서 읽어 낸 항목만 담는다) */
export type FormatRulesPatch = { [K in keyof FormatRules]?: Partial<Record<string, unknown>> };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const FONT_LEAF = /^(body|headings\.h[1-4])\.font$/;
const MAX_FONT_NAME = 60;

function leaves(obj: unknown, path: string[] = []): string[][] {
  if (!isPlainObject(obj)) return [path];
  return Object.keys(obj).flatMap((k) => leaves(obj[k], [...path, k]));
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const p of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown) {
  let cur = obj;
  for (const p of path.slice(0, -1)) {
    if (!isPlainObject(cur[p])) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

/**
 * AI가 자유 텍스트에서 만든 rulesJson 후보를 `formatRulesSchema`(normalizeRules)로 검증해,
 * 입력에 들어 있고 올바른 항목만 남긴 규칙 조각을 돌려준다. 순수 함수.
 * - 스키마에 없는 키, 범위를 벗어난 값, 형식이 틀린 값은 버린다 (지어낸 기본값으로 채우지 않는다).
 * - 글꼴은 제공 글꼴이면 글꼴 ID로 바꾸고, 대체가 필요한 글꼴(함초롬바탕 등)은 요청한 이름을 그대로 둔다.
 *   폼에 채울 때 `normalizeRules`가 대체 글꼴로 바꾸고 사용자에게 알린다 (SPEC 7.3 (d)).
 * - 올바른 항목이 하나도 없으면 예외를 던진다.
 */
export function validateRulesPatch(raw: unknown): FormatRulesPatch {
  if (!isPlainObject(raw)) throw new Error("서식 규칙은 객체여야 합니다.");
  const { rules, defaulted } = normalizeRules(raw, DEFAULT_RULES);
  const invalid = new Set(defaulted);
  const out: Record<string, unknown> = {};
  for (const path of leaves(DEFAULT_RULES)) {
    const value = getPath(raw, path);
    if (value === undefined || value === null) continue;
    const key = path.join(".");
    if (FONT_LEAF.test(key)) {
      if (typeof value !== "string" || !value.trim() || value.length > MAX_FONT_NAME) continue;
      const resolved = resolveFont(value);
      setPath(out, path, resolved.substituted ? resolved.requested : resolved.font);
      continue;
    }
    if (invalid.has(key)) continue;
    setPath(out, path, getPath(rules, path));
  }
  if (Object.keys(out).length === 0) throw new Error("올바른 서식 항목이 없습니다.");
  return out as FormatRulesPatch;
}
