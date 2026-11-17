import { describe, expect, it } from "vitest";
import type { ChartSuggestion } from "@/lib/ai/shared";
import type { ColumnInfo } from "@/lib/csv/parse";
import { defaultChartConfig } from "@/lib/data/chart";
import { chartConfigFromSuggestion, firstApplicableSuggestion } from "@/lib/data/chart-suggestion";

const columns: ColumnInfo[] = [
  { name: "주파수", type: "number", unit: "Hz", missing: 0 },
  { name: "감쇠율", type: "number", unit: "dB", missing: 0 },
  { name: "오차", type: "number", unit: null, missing: 0 },
  { name: "시료", type: "string", unit: null, missing: 0 },
];
const base = { ...defaultChartConfig(columns), bins: 7 };
const s = (over: Partial<ChartSuggestion>): ChartSuggestion => ({
  chartType: "scatter",
  x: "주파수",
  y: ["감쇠율"],
  errorBar: null,
  logX: false,
  logY: false,
  trendline: false,
  xTitle: "",
  yTitle: "",
  reason: "",
  ...over,
});

describe("그래프 추천 → 그래프 만들기 설정 (SPEC 7.3 (e))", () => {
  it("산점도: 축 열·오차막대·로그·추세선을 옮기고, 제목에 붙은 단위는 단위 칸으로 뗀다", () => {
    const config = chartConfigFromSuggestion(
      base,
      s({ errorBar: "오차", logX: true, trendline: true, xTitle: "주파수 (Hz)", yTitle: "감쇠율 (dB)" }),
      columns,
    );
    expect(config).toMatchObject({
      type: "scatter",
      x: "주파수",
      y: "감쇠율",
      error: "오차",
      logX: true,
      trendline: true,
      xTitle: "주파수",
      xUnit: "Hz",
      yTitle: "감쇠율",
      yUnit: "dB",
    });
    // 수치 설정은 추천에서 받지 않는다
    expect(config?.bins).toBe(7);
  });

  it("히스토그램은 y[0]을 값 열(x)로, 상자그림은 x를 묶음 열·y[0]을 값 열로 옮긴다", () => {
    expect(chartConfigFromSuggestion(base, s({ chartType: "histogram", x: null, y: ["감쇠율"], yTitle: "빈도" }), columns)).toMatchObject({
      type: "histogram",
      x: "감쇠율",
      error: null,
      yTitle: "빈도",
    });
    expect(chartConfigFromSuggestion(base, s({ chartType: "box", x: "시료", y: ["감쇠율"] }), columns)).toMatchObject({
      type: "box",
      x: "시료",
      y: "감쇠율",
    });
    expect(chartConfigFromSuggestion(base, s({ chartType: "box", x: null, y: ["감쇠율"] }), columns)).toMatchObject({ x: null, y: "감쇠율" });
  });

  it("데이터에 없는 열이나 빈 축을 쓴 추천은 버리고, 쓸 수 있는 첫 추천을 고른다", () => {
    expect(chartConfigFromSuggestion(base, s({ x: "없는 열" }), columns)).toBeNull();
    expect(chartConfigFromSuggestion(base, s({ errorBar: "없는 열" }), columns)).toBeNull();
    expect(chartConfigFromSuggestion(base, s({ y: [] }), columns)).toBeNull();
    const picked = firstApplicableSuggestion(base, { datasetId: "d", suggestions: [s({ y: ["가짜"] }), s({ chartType: "line", reason: "시간 변화" })] }, columns);
    expect(picked?.config.type).toBe("line");
    expect(picked?.suggestion.reason).toBe("시간 변화");
    expect(firstApplicableSuggestion(base, { datasetId: "d", suggestions: [] }, columns)).toBeNull();
  });
});
