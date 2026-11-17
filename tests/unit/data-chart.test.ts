import { readFileSync } from "node:fs";
import path from "node:path";
import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { parseCsv, type ColumnInfo } from "@/lib/csv/parse";
import { boxStats, histogram, linearRegression } from "@/lib/csv/stats";
import {
  axisTitle,
  buildChart,
  chartCaption,
  chartConfigSchema,
  defaultChartConfig,
  formatSig,
  trendLabel,
  type ChartConfig,
} from "@/lib/data/chart";
import { ChartImageAttributes } from "@/lib/data/chart-image";
import { chartImageNode, withCaption } from "@/lib/data/doc-nodes";
import { documentExtensions } from "@/lib/editor/extensions";

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, "../fixtures/csv", name)));

const num = (name: string, unit: string | null = null): ColumnInfo => ({ name, type: "number", unit, missing: 0 });
const cfg = (c: Partial<ChartConfig>) => chartConfigSchema.parse({ type: "scatter", x: null, y: null, ...c });

/** Plotly 트레이스의 x/y 배열 (테스트용) */
const trace = (r: ReturnType<typeof buildChart>, i = 0) => {
  if (!r.ok) throw new Error(r.error);
  return r.data[i] as unknown as Record<string, unknown> & { x: unknown[]; y: unknown[] };
};

describe("그래프 설정 (P4-3)", () => {
  const columns = [num("x"), num("y", "cm"), num("err"), { name: "그룹", type: "string", unit: null, missing: 0 } as ColumnInfo];
  const rows = [
    ["1", "2.1 cm", "0.1", "A"],
    ["2", "3.9 cm", "0.2", "A"],
    ["3", "6.2 cm", "", "B"],
    ["4", "", "0.1", "B"],
    ["5", "9.8 cm", "0.3", "B"],
  ];

  it("기본 설정은 첫 숫자 열을 X, 다음 숫자 열을 Y로 하고 단위를 가져온다", () => {
    const c = defaultChartConfig(columns);
    expect(c).toMatchObject({ type: "scatter", x: "x", y: "y", yUnit: "cm", trendline: false, format: "svg", logX: false });
  });

  it("산점도 + 추세선: 결측 행은 빼고, 추세선·R²는 stats.linearRegression 값과 같다", () => {
    const r = buildChart(cfg({ x: "x", y: "y", trendline: true }), columns, rows);
    if (!r.ok) throw new Error(r.error);
    expect(r.n).toBe(4);
    expect(r.warnings).toEqual(["결측값이 있는 1개 행은 빼고 그렸습니다."]);
    const expected = linearRegression([
      [1, 2.1],
      [2, 3.9],
      [3, 6.2],
      [5, 9.8],
    ])!;
    expect(r.regression).toEqual(expected);
    const line = trace(r, 1);
    expect(line.x).toEqual([1, 5]);
    expect(line.y[0]).toBeCloseTo(expected.slope + expected.intercept, 10);
    expect(line.y[1]).toBeCloseTo(expected.slope * 5 + expected.intercept, 10);
    expect(line.name).toBe(trendLabel(expected));
    expect(r.layout.annotations?.[0].text).toBe(trendLabel(expected));
  });

  it("오차막대 열은 error_y 배열로 들어가고 결측 오차는 0", () => {
    const r = buildChart(cfg({ type: "bar", x: "x", y: "y", error: "err" }), columns, rows);
    expect(trace(r).error_y).toMatchObject({ type: "data", array: [0.1, 0.2, 0, 0.3] });
  });

  it("꺾은선은 X 순서로 정렬한다", () => {
    const shuffled = [rows[2], rows[0], rows[4], rows[1]];
    expect(trace(buildChart(cfg({ type: "line", x: "x", y: "y" }), columns, shuffled)).x).toEqual([1, 2, 3, 5]);
  });

  it("로그 축: 0 이하 값은 빼고 경고, 추세선은 원래 값으로 계산한다는 경고", () => {
    const r = buildChart(cfg({ x: "x", y: "y", logY: true, logX: true, trendline: true }), columns, [...rows, ["0", "1 cm", "", "A"]]);
    if (!r.ok) throw new Error(r.error);
    expect(r.n).toBe(4);
    expect(r.warnings).toContain("로그 축에 그릴 수 없는 0 이하 값 1개를 뺐습니다.");
    expect(r.warnings).toContain("추세선은 로그 변환 없이 원래 값으로 계산한 직선입니다.");
    expect(r.layout.xaxis?.type).toBe("log");
    expect(r.layout.yaxis?.type).toBe("log");
  });

  it("축 제목에 단위를 붙인다", () => {
    expect(axisTitle("길이", "cm")).toBe("길이 (cm)");
    expect(axisTitle("", "cm")).toBe("(cm)");
    expect(axisTitle("길이", " ")).toBe("길이");
    const r = buildChart(cfg({ x: "x", y: "y", xTitle: "시간", xUnit: "s", yTitle: "길이", yUnit: "cm" }), columns, rows);
    if (!r.ok) throw new Error(r.error);
    expect(r.layout.xaxis?.title).toEqual({ text: "시간 (s)" });
    expect(r.layout.yaxis?.title).toEqual({ text: "길이 (cm)" });
  });

  it("히스토그램 구간은 stats.histogram과 같다", () => {
    const r = buildChart(cfg({ type: "histogram", x: "y", bins: 2 }), columns, rows);
    const bins = histogram([2.1, 3.9, 6.2, 9.8], 2);
    const t = trace(r);
    expect(t.y).toEqual(bins.map((b) => b.count));
    expect(t.x).toEqual(bins.map((b) => (b.start + b.end) / 2));
  });

  it("상자그림은 묶음별 boxStats 값을 쓴다", () => {
    const r = buildChart(cfg({ type: "box", x: "그룹", y: "y" }), columns, rows);
    const t = trace(r);
    const a = boxStats([2.1, 3.9])!;
    const b = boxStats([6.2, 9.8])!;
    expect(t.x).toEqual(["A", "B"]);
    expect(t.median).toEqual([a.median, b.median]);
    expect(t.q1).toEqual([a.q1, b.q1]);
    expect(t.upperfence).toEqual([a.whiskerHigh, b.whiskerHigh]);
  });

  it("잘못된 설정은 이유와 함께 실패한다", () => {
    expect(buildChart(cfg({ x: null, y: "y" }), columns, rows)).toEqual({ ok: false, error: "X 열을 골라 주세요." });
    expect(buildChart(cfg({ x: "x", y: "없는 열" }), columns, rows)).toEqual({ ok: false, error: "\"없는 열\" 열을 찾을 수 없습니다." });
    expect(buildChart(cfg({ x: "x", y: "그룹" }), columns, rows)).toMatchObject({ ok: false, error: expect.stringContaining("숫자가 아니어서") });
    expect(buildChart(cfg({ x: "x", y: "y" }), columns, [["", "", "", ""]])).toEqual({ ok: false, error: "그릴 수 있는 값이 없습니다. 결측값이나 열 선택을 확인해 주세요." });
    const s = buildChart(cfg({ x: "그룹", y: "y", trendline: true }), columns, rows);
    expect(s.ok && s.warnings).toContain("추세선은 X 열이 숫자일 때만 그릴 수 있습니다.");
    const one = buildChart(cfg({ x: "x", y: "y", trendline: true }), columns, [rows[0]]);
    expect(one.ok && one.warnings).toContain("점이 2개 미만이거나 X 값이 모두 같아 추세선을 계산할 수 없습니다.");
  });

  it("추세선 문구와 캡션 기본값", () => {
    expect(formatSig(1.234567)).toBe("1.235");
    expect(trendLabel({ slope: 2, intercept: -0.5, r2: 0.98765, n: 3 })).toBe("y = 2x − 0.5, R² = 0.9877");
    expect(chartCaption(cfg({ x: "시간", y: "진폭" }))).toBe("시간에 따른 진폭");
    expect(chartCaption(cfg({ type: "histogram", x: "진폭" }))).toBe("진폭의 분포");
  });

  it("설정 검증: 알 수 없는 유형은 거부", () => {
    expect(chartConfigSchema.safeParse({ type: "pie", x: "a", y: "b" }).success).toBe(false);
  });
});

describe("그래프 이미지 노드와 Dataset 연결", () => {
  const schema = getSchema([...documentExtensions(), ChartImageAttributes]);

  it("image 노드 attrs에 datasetId와 차트 설정이 저장되고, 그림 아래에 캡션이 붙는다", () => {
    const chart = cfg({ x: "x", y: "y", trendline: true });
    const image = chartImageNode({ src: "data:image/svg+xml,<svg/>", alt: "그림", datasetId: "ds1", chart });
    const node = schema.nodeFromJSON(image);
    expect(node.attrs.datasetId).toBe("ds1");
    expect(node.attrs.chart).toEqual(chart);
    expect(chartConfigSchema.parse(node.toJSON().attrs.chart)).toEqual(chart);
    const [first, second] = withCaption(image, { kind: "figure", id: "fig-1", text: "x에 따른 y" });
    expect(first).toBe(image);
    expect(second).toMatchObject({ type: "caption", attrs: { kind: "figure", id: "fig-1" } });
  });
});

describe("P4-4: CP949 한글 CSV → 그래프", () => {
  it("CP949 파일의 한글 열 이름으로 산점도 + 추세선을 만들고, UTF-8 파일과 결과가 같다", () => {
    const a = parseCsv(fixture("korean-cp949.csv"));
    const b = parseCsv(fixture("korean-utf8-bom.csv"));
    const config = { ...defaultChartConfig(a.columns), trendline: true };
    expect(config).toMatchObject({ x: "시간(s)", y: "진폭", yUnit: "mm" });
    const ra = buildChart(config, a.columns, a.rows);
    const rb = buildChart(config, b.columns, b.rows);
    expect(ra).toEqual(rb);
    if (!ra.ok) throw new Error(ra.error);
    expect(ra.n).toBe(5);
    expect(ra.regression!.r2).toBeGreaterThan(0.9);
    expect(ra.layout.yaxis?.title).toEqual({ text: "(mm)" });
    expect(chartCaption(config)).toBe("시간(s)에 따른 진폭");
    expect(JSON.stringify(ra)).not.toContain("�");
  });

  it("결측값이 있는 열(온도)은 그 행만 빼고 그린다", () => {
    const a = parseCsv(fixture("korean-cp949.csv"));
    const r = buildChart(cfg({ type: "line", x: "시간(s)", y: "온도" }), a.columns, a.rows);
    if (!r.ok) throw new Error(r.error);
    expect(r.n).toBe(4);
    expect(r.warnings).toEqual(["결측값이 있는 1개 행은 빼고 그렸습니다."]);
  });

  it("단위가 섞인 열(길이)은 숫자 축에 쓸 수 없다고 알려 주고, 단위가 같은 열(질량)은 그린다", () => {
    const u = parseCsv(fixture("mixed-units.csv"));
    expect(buildChart(cfg({ type: "bar", x: "시료", y: "길이" }), u.columns, u.rows)).toMatchObject({ ok: false });
    const r = buildChart(cfg({ type: "bar", x: "시료", y: "질량" }), u.columns, u.rows);
    expect(trace(r).y).toEqual([1200, 1150, 980]);
    const d = buildChart(cfg({ type: "line", x: "측정일", y: "질량" }), u.columns, u.rows);
    expect(trace(d).x).toEqual(["2026-03-01", "2026-03-02", "2026-03-05"]);
  });
});
