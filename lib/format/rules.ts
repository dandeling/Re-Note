import { z } from "zod";
import { FONT_IDS, isFontId, resolveFont, type FontId } from "@/lib/format/fonts";

/** 용지 크기 (mm, 세로 방향 기준). B5는 국내 문서에서 쓰는 182×257(JIS B5, 46배판). */
export const PAPER_SIZES = {
  A4: { width: 210, height: 297 },
  B5: { width: 182, height: 257 },
  Letter: { width: 215.9, height: 279.4 },
} as const;
export type PaperSize = keyof typeof PAPER_SIZES;

export const HEADING_LEVELS = ["h1", "h2", "h3", "h4"] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

const fontSchema = z.enum(FONT_IDS);
const sizePt = z.number().min(6).max(48);
const marginMm = z.number().min(0).max(60);
const headingStyleSchema = z.object({
  font: fontSchema,
  sizePt,
  bold: z.boolean(),
  align: z.enum(["left", "center", "right"]),
});

/**
 * 서식 규칙(rulesJson) 스키마 (SPEC 7.3 (d)).
 * 폼, 프리셋, AI 변환 결과, 서식 검사, 내보내기가 모두 이 모양을 쓴다.
 */
export const formatRulesSchema = z.object({
  /** 용지 */
  page: z.object({
    size: z.enum(["A4", "B5", "Letter"]),
    orientation: z.enum(["portrait", "landscape"]),
    /** 여백 (mm) */
    margin: z.object({ top: marginMm, right: marginMm, bottom: marginMm, left: marginMm }),
  }),
  /** 본문 */
  body: z.object({
    font: fontSchema,
    sizePt,
    /** 줄 간격 (%, 160 = 글자 크기의 1.6배) */
    lineHeight: z.number().min(100).max(300),
    align: z.enum(["left", "justify"]),
  }),
  /** 문단 */
  paragraph: z.object({
    /** 첫 줄 들여쓰기 (pt) */
    indentPt: z.number().min(0).max(60),
    /** 문단 아래 간격 (pt) */
    spacingPt: z.number().min(0).max(40),
  }),
  /** 제목 단계별 스타일 */
  headings: z.object({ h1: headingStyleSchema, h2: headingStyleSchema, h3: headingStyleSchema, h4: headingStyleSchema }),
  /** 캡션 */
  caption: z.object({
    sizePt,
    bold: z.boolean(),
    align: z.enum(["left", "center", "right"]),
    /** 그림 캡션 위치 (기본: 아래) */
    figurePosition: z.enum(["above", "below"]),
    /** 표 캡션 위치 (기본: 위) */
    tablePosition: z.enum(["above", "below"]),
  }),
  /** 쪽 번호 */
  pageNumber: z.object({
    enabled: z.boolean(),
    position: z.enum(["bottom-center", "bottom-right", "top-center", "top-right"]),
    /** n: "3", dash: "- 3 -", total: "3 / 10" */
    style: z.enum(["n", "dash", "total"]),
  }),
});

export type FormatRules = z.infer<typeof formatRulesSchema>;
export type HeadingStyle = FormatRules["headings"]["h1"];

/** 템플릿이 없는 문서에 쓰는 기본 규칙 (= "일반 보고서" 프리셋) */
export const DEFAULT_RULES: FormatRules = {
  page: { size: "A4", orientation: "portrait", margin: { top: 25, right: 25, bottom: 25, left: 25 } },
  body: { font: "noto-sans-kr", sizePt: 11, lineHeight: 160, align: "justify" },
  paragraph: { indentPt: 0, spacingPt: 6 },
  headings: {
    h1: { font: "noto-sans-kr", sizePt: 18, bold: true, align: "left" },
    h2: { font: "noto-sans-kr", sizePt: 15, bold: true, align: "left" },
    h3: { font: "noto-sans-kr", sizePt: 13, bold: true, align: "left" },
    h4: { font: "noto-sans-kr", sizePt: 11, bold: true, align: "left" },
  },
  caption: { sizePt: 10, bold: false, align: "center", figurePosition: "below", tablePosition: "above" },
  pageNumber: { enabled: true, position: "bottom-center", style: "n" },
};

/** 용지의 실제 크기 (mm, 방향 반영) */
export function pageDimensions(rules: FormatRules): { width: number; height: number } {
  const { width, height } = PAPER_SIZES[rules.page.size];
  return rules.page.orientation === "landscape" ? { width: height, height: width } : { width, height };
}

export type FontNotice = {
  /** 규칙 안에서의 위치 (예: "body.font", "headings.h1.font") */
  path: string;
  requested: string;
  font: FontId;
};

export type NormalizedRules = {
  rules: FormatRules;
  /** 요청한 글꼴을 쓸 수 없어 대체한 내역 (사용자에게 알려야 한다) */
  fontNotices: FontNotice[];
  /** 값이 없거나 올바르지 않아 기본값으로 채운 위치 */
  defaulted: string[];
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function getPath(obj: unknown, path: PropertyKey[]): unknown {
  let cur = obj;
  for (const p of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[p as string];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: PropertyKey[], value: unknown) {
  let cur = obj;
  for (const p of path.slice(0, -1)) {
    if (!isPlainObject(cur[p as string])) cur[p as string] = {};
    cur = cur[p as string] as Record<string, unknown>;
  }
  cur[path[path.length - 1] as string] = value;
}

/** base의 모양을 따라 input 값을 덮어쓴다 (base에 없는 키는 버린다). */
function overlay(base: unknown, input: unknown, path: string[], missing: string[]): unknown {
  if (!isPlainObject(base)) {
    if (input === undefined || input === null) {
      missing.push(path.join("."));
      return base;
    }
    return input;
  }
  const out: Record<string, unknown> = {};
  const src = isPlainObject(input) ? input : {};
  for (const k of Object.keys(base)) out[k] = overlay(base[k], src[k], [...path, k], missing);
  return out;
}

const FONT_PATHS: string[][] = [["body", "font"], ...HEADING_LEVELS.map((h) => ["headings", h, "font"])];

/**
 * 임의의 입력(저장된 rulesJson, AI 변환 결과, 일부만 채운 규칙)을 완전한 규칙으로 만든다. 순수 함수.
 * - 글꼴은 이름으로 들어와도 된다. 제공하지 않는 글꼴은 가장 가까운 글꼴로 바꾸고 `fontNotices`에 적는다.
 * - 제목 글꼴을 따로 주지 않으면 본문 글꼴을 따른다.
 * - 빠졌거나 범위를 벗어난 값은 `fallback`(기본: 일반 보고서) 값으로 채우고 `defaulted`에 적는다.
 */
export function normalizeRules(input: unknown, fallback: FormatRules = DEFAULT_RULES): NormalizedRules {
  const missing: string[] = [];
  const merged = overlay(fallback, input, [], missing) as Record<string, unknown>;
  const fontNotices: FontNotice[] = [];

  for (const path of FONT_PATHS) {
    const raw = getPath(input, path);
    if (typeof raw !== "string" || raw.trim() === "" || isFontId(raw)) continue;
    const resolved = resolveFont(raw);
    setPath(merged, path, resolved.font);
    if (resolved.substituted) fontNotices.push({ path: path.join("."), requested: resolved.requested, font: resolved.font });
  }
  // 제목 글꼴이 입력에 없으면 본문 글꼴을 따른다 (본문 글꼴이 입력에 있을 때만).
  if (typeof getPath(input, ["body", "font"]) === "string") {
    for (const h of HEADING_LEVELS) {
      if (typeof getPath(input, ["headings", h, "font"]) !== "string") {
        setPath(merged, ["headings", h, "font"], getPath(merged, ["body", "font"]));
      }
    }
  }

  const defaulted = new Set(missing.filter((p) => !(p.startsWith("headings.") && p.endsWith(".font"))));
  let parsed = formatRulesSchema.safeParse(merged);
  // 올바르지 않은 값은 그 자리만 기본값으로 되돌린다.
  for (let i = 0; i < 3 && !parsed.success; i += 1) {
    for (const issue of parsed.error.issues) {
      setPath(merged, issue.path, getPath(fallback, issue.path));
      defaulted.add(issue.path.join("."));
    }
    parsed = formatRulesSchema.safeParse(merged);
  }
  return {
    rules: parsed.success ? parsed.data : fallback,
    fontNotices,
    defaulted: isPlainObject(input) ? [...defaulted].sort() : [],
  };
}
