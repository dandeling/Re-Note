import type { ChartSuggestion } from "@/lib/ai/shared";
import type { ColumnInfo } from "@/lib/csv/parse";
import { chartConfigSchema, CHART_TYPES, type ChartConfig } from "@/lib/data/chart";

/**
 * POST /api/ai/chart-suggest 응답 (서버 `suggestChart`와 같은 모양, 챗봇의 chart 제안도 같은 `ChartSuggestion`을 쓴다).
 * 유형·축 구성만 담고 수치는 담지 않는다 (SPEC 7.3 (e)).
 */
export type ChartSuggestResponse = { datasetId: string; suggestions: ChartSuggestion[] };

/** "주파수 (Hz)"처럼 단위가 붙은 축 제목에서 단위를 뗀다 (단위는 따로 xUnit/yUnit에 둔다). */
function stripUnit(title: string, unit: string) {
  const t = title.trim();
  if (!unit) return t;
  const suffix = `(${unit})`;
  return t.endsWith(suffix) ? t.slice(0, -suffix.length).trim() : t;
}

/**
 * 그래프 추천 한 건을 그래프 만들기 설정으로 바꾼다. 순수 함수.
 * - 추천의 열 이름이 이 데이터에 없으면 null (지어낸 열은 쓰지 않는다).
 * - 서버 형식(히스토그램·상자그림은 x가 null이고 대상 열이 y[0])을 클라이언트 설정
 *   (히스토그램: x = 값 열, 상자그림: x = 묶음 열, y = 값 열)으로 옮긴다.
 * - 수치(구간 수 등)는 추천에서 받지 않고 `base` 값을 유지한다. 그리기는 원본 데이터로 결정적으로 한다.
 */
export function chartConfigFromSuggestion(base: ChartConfig, s: ChartSuggestion, columns: ColumnInfo[]): ChartConfig | null {
  if (!(CHART_TYPES as readonly string[]).includes(s.chartType)) return null;
  const byName = new Map(columns.map((c) => [c.name, c]));
  const known = (name: string | null | undefined) => name == null || byName.has(name);
  const target = s.y[0] ?? null;
  if (!known(s.x) || !known(target) || !known(s.errorBar)) return null;

  let x: string | null;
  let y: string | null;
  if (s.chartType === "histogram") {
    x = target ?? s.x;
    y = base.y;
  } else if (s.chartType === "box") {
    x = s.x;
    y = target;
  } else {
    x = s.x;
    y = target;
  }
  if (!x && s.chartType !== "box") return null;
  if (!y && s.chartType !== "histogram") return null;

  const xUnit = (s.chartType === "box" ? null : byName.get(x ?? "")?.unit) ?? "";
  const yUnit = s.chartType === "histogram" ? "" : (byName.get(y ?? "")?.unit ?? "");
  const parsed = chartConfigSchema.safeParse({
    ...base,
    type: s.chartType,
    x,
    y,
    error: s.chartType === "histogram" || s.chartType === "box" ? null : s.errorBar,
    logX: s.logX,
    logY: s.logY,
    trendline: s.trendline,
    xTitle: stripUnit(s.xTitle, xUnit).slice(0, 200),
    yTitle: stripUnit(s.yTitle, yUnit).slice(0, 200),
    xUnit,
    yUnit,
  });
  return parsed.success ? parsed.data : null;
}

/** 응답에서 이 데이터에 쓸 수 있는 첫 추천을 설정으로 바꾼다. */
export function firstApplicableSuggestion(
  base: ChartConfig,
  res: ChartSuggestResponse,
  columns: ColumnInfo[],
): { config: ChartConfig; suggestion: ChartSuggestion } | null {
  for (const suggestion of res.suggestions ?? []) {
    const config = chartConfigFromSuggestion(base, suggestion, columns);
    if (config) return { config, suggestion };
  }
  return null;
}
