import type { Data, Layout } from "plotly.js";
import { z } from "zod";
import { isMissing, parseDate, parseNumber, type ColumnInfo } from "@/lib/csv/parse";
import { boxStats, histogram, linearRegression, type Regression } from "@/lib/csv/stats";
import { messages } from "@/lib/messages";

/**
 * 그래프 설정 → Plotly 트레이스·레이아웃. 추세선·R²·히스토그램·상자그림 수치는 모두
 * lib/csv/stats.ts로 코드에서 계산한다 (AI가 수치를 만들지 않는다, SPEC 7.3 (e)).
 */

export const CHART_TYPES = ["line", "scatter", "bar", "histogram", "box"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

const col = z.string().max(200).nullable();
const text = z.string().max(200);

/** image 노드 attrs.chart에 저장하는 설정. 열은 이름으로 가리킨다. */
export const chartConfigSchema = z.object({
  type: z.enum(CHART_TYPES),
  /** 꺾은선·산점도·막대: X 열. 히스토그램: 값 열. 상자그림: 묶음 열(선택) */
  x: col,
  /** 꺾은선·산점도·막대: Y 열. 상자그림: 값 열. 히스토그램: 쓰지 않음 */
  y: col,
  /** 오차막대 열 (Y 방향, 꺾은선·산점도·막대) */
  error: col.default(null),
  xTitle: text.default(""),
  yTitle: text.default(""),
  xUnit: text.default(""),
  yUnit: text.default(""),
  logX: z.boolean().default(false),
  logY: z.boolean().default(false),
  trendline: z.boolean().default(false),
  bins: z.number().int().min(1).max(200).nullable().default(null),
  format: z.enum(["svg", "png"]).default("svg"),
});
export type ChartConfig = z.infer<typeof chartConfigSchema>;

/** 차트 유형별로 어떤 입력을 쓰는가 (UI와 계산이 같은 규칙을 쓴다) */
export function chartUses(type: ChartType) {
  return {
    xy: type === "line" || type === "scatter" || type === "bar",
    error: type === "line" || type === "scatter" || type === "bar",
    trendline: type === "line" || type === "scatter",
    bins: type === "histogram",
    logX: type === "line" || type === "scatter" || type === "histogram",
  };
}

/** 데이터셋 열로 만든 기본 설정: 첫 숫자 열을 X, 다음 숫자 열을 Y */
export function defaultChartConfig(columns: ColumnInfo[], type: ChartType = "scatter"): ChartConfig {
  const numeric = columns.filter((c) => c.type === "number");
  const x = numeric[0] ?? columns[0];
  const y = numeric.find((c) => c !== x) ?? numeric[0] ?? null;
  return chartConfigSchema.parse({
    type,
    x: x?.name ?? null,
    y: y?.name ?? null,
    xUnit: x?.unit ?? "",
    yUnit: y?.unit ?? "",
  });
}

export function axisTitle(title: string, unit: string) {
  const t = title.trim();
  const u = unit.trim();
  if (!t) return u ? `(${u})` : "";
  return u ? `${t} (${u})` : t;
}

/** 유효 숫자 4자리로 줄여 표시 (지수 표기 없이 가능한 범위에서) */
export function formatSig(v: number, digits = 4) {
  if (v === 0) return "0";
  return String(Number(v.toPrecision(digits)));
}

export function trendLabel(r: Regression) {
  return messages.data.chart.trendLabel
    .replace("{slope}", formatSig(r.slope))
    .replace("{sign}", r.intercept < 0 ? "−" : "+")
    .replace("{intercept}", formatSig(Math.abs(r.intercept)))
    .replace("{r2}", r.r2.toFixed(4));
}

export type ChartResult =
  | {
      ok: true;
      data: Data[];
      layout: Partial<Layout>;
      /** 실제로 그린 점(또는 값) 개수 */
      n: number;
      regression: Regression | null;
      warnings: string[];
    }
  | { ok: false; error: string };

const E = messages.data.chart.errors;
const W = messages.data.chart.warnings;
const fail = (error: string): ChartResult => ({ ok: false, error });

type Cell = number | string;

/** 열 값을 그래프 값으로: 숫자 열은 숫자, 날짜 열은 ISO 문자열, 문자 열은 원본. 결측은 null */
function columnValues(rows: string[][], index: number, info: ColumnInfo): (Cell | null)[] {
  return rows.map((r) => {
    const raw = r[index] ?? "";
    if (isMissing(raw)) return null;
    if (info.type === "number") return parseNumber(raw)?.value ?? null;
    if (info.type === "date") {
      const t = parseDate(raw);
      return t == null ? null : new Date(t).toISOString().replace(/T00:00:00\.000Z$/, "").replace(".000Z", "");
    }
    return raw;
  });
}

function findColumn(columns: ColumnInfo[], name: string | null) {
  if (name == null) return null;
  const index = columns.findIndex((c) => c.name === name);
  return index < 0 ? undefined : { index, info: columns[index] };
}

const n = (s: string, v: number) => s.replace("{n}", String(v));

export function chartCaption(config: ChartConfig) {
  const c = messages.data.chart;
  if (config.type === "histogram") return c.captionDist.replace("{x}", config.xTitle || config.x || "");
  if (config.type === "box") return c.captionDist.replace("{x}", config.yTitle || config.y || "");
  return c.captionXY.replace("{x}", config.xTitle || config.x || "").replace("{y}", config.yTitle || config.y || "");
}

export function buildChart(config: ChartConfig, columns: ColumnInfo[], rows: string[][]): ChartResult {
  const uses = chartUses(config.type);
  const warnings: string[] = [];
  const xCol = findColumn(columns, config.x);
  const yCol = findColumn(columns, config.y);
  const errCol = uses.error ? findColumn(columns, config.error) : null;
  for (const [c, name] of [
    [xCol, config.x],
    [yCol, config.y],
    [errCol, config.error],
  ] as const) {
    if (c === undefined) return fail(E.unknownColumn.replace("{name}", name ?? ""));
  }
  const mustBeNumber = (c: { info: ColumnInfo } | null | undefined) =>
    c && c.info.type !== "number" ? fail(E.notNumber.replace("{name}", c.info.name)) : null;

  const layout: Partial<Layout> = {
    xaxis: { title: { text: axisTitle(config.xTitle, config.xUnit) }, type: config.logX && uses.logX ? "log" : undefined, automargin: true },
    yaxis: { title: { text: axisTitle(config.yTitle, config.yUnit) }, type: config.logY ? "log" : undefined, automargin: true },
    showlegend: false,
    margin: { l: 70, r: 30, t: 30, b: 60 },
    font: { family: "Pretendard, 'Noto Sans KR', 'Malgun Gothic', sans-serif", size: 14 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
  };

  if (config.type === "histogram") {
    if (!xCol) return fail(E.needValue);
    const bad = mustBeNumber(xCol);
    if (bad) return bad;
    const raw = columnValues(rows, xCol.index, xCol.info);
    let values = raw.filter((v): v is number => typeof v === "number");
    if (values.length < raw.length) warnings.push(n(W.missingDropped, raw.length - values.length));
    if (config.logX) {
      const kept = values.filter((v) => v > 0);
      if (kept.length < values.length) warnings.push(n(W.logDropped, values.length - kept.length));
      values = kept;
    }
    if (values.length === 0) return fail(E.noPoints);
    // 로그 X축이면 로그 공간에서 같은 폭으로 나눈다.
    const bins = config.logX
      ? histogram(values.map(Math.log10), config.bins ?? undefined).map((b) => ({ start: 10 ** b.start, end: 10 ** b.end, count: b.count }))
      : histogram(values, config.bins ?? undefined);
    const yTitle = axisTitle(config.yTitle || messages.data.chart.count, config.yUnit);
    return {
      ok: true,
      data: [
        {
          type: "bar",
          x: bins.map((b) => (config.logX ? Math.sqrt(b.start * b.end) : (b.start + b.end) / 2)),
          y: bins.map((b) => b.count),
          width: config.logX ? undefined : bins.map((b) => b.end - b.start || 1),
          marker: { color: "#2563eb", line: { color: "#1e3a8a", width: 1 } },
        },
      ],
      layout: { ...layout, yaxis: { ...layout.yaxis, title: { text: yTitle } }, bargap: 0 },
      n: values.length,
      regression: null,
      warnings,
    };
  }

  if (config.type === "box") {
    if (!yCol) return fail(E.needValue);
    const bad = mustBeNumber(yCol);
    if (bad) return bad;
    const vals = columnValues(rows, yCol.index, yCol.info);
    const groups = xCol ? columnValues(rows, xCol.index, xCol.info) : null;
    const byGroup = new Map<string, number[]>();
    let dropped = 0;
    let logDropped = 0;
    vals.forEach((v, i) => {
      const g = groups ? groups[i] : "";
      if (typeof v !== "number" || g == null) return void (dropped += 1);
      if (config.logY && v <= 0) return void (logDropped += 1);
      const key = String(g);
      byGroup.set(key, [...(byGroup.get(key) ?? []), v]);
    });
    if (dropped) warnings.push(n(W.missingDropped, dropped));
    if (logDropped) warnings.push(n(W.logDropped, logDropped));
    const names = [...byGroup.keys()];
    const stats = names.map((k) => boxStats(byGroup.get(k)!)!);
    if (names.length === 0) return fail(E.noPoints);
    const label = (k: string) => k || config.yTitle || config.y || "";
    const outX: string[] = [];
    const outY: number[] = [];
    names.forEach((k, i) => stats[i].outliers.forEach((o) => (outX.push(label(k)), outY.push(o))));
    return {
      ok: true,
      data: [
        {
          type: "box",
          x: names.map(label),
          q1: stats.map((s) => s.q1),
          median: stats.map((s) => s.median),
          q3: stats.map((s) => s.q3),
          lowerfence: stats.map((s) => s.whiskerLow),
          upperfence: stats.map((s) => s.whiskerHigh),
          marker: { color: "#2563eb" },
        } as Data,
        ...(outX.length ? [{ type: "scatter", mode: "markers", x: outX, y: outY, marker: { color: "#dc2626", size: 7 } } as Data] : []),
      ],
      layout: { ...layout, xaxis: { ...layout.xaxis, type: "category" } },
      n: stats.reduce((a, _, i) => a + byGroup.get(names[i])!.length, 0),
      regression: null,
      warnings,
    };
  }

  // 꺾은선·산점도·막대
  if (!xCol) return fail(E.needX);
  if (!yCol) return fail(E.needY);
  const badY = mustBeNumber(yCol) ?? mustBeNumber(errCol);
  if (badY) return badY;
  const xs = columnValues(rows, xCol.index, xCol.info);
  const ys = columnValues(rows, yCol.index, yCol.info);
  const es = errCol ? columnValues(rows, errCol.index, errCol.info) : null;
  let pts: { x: Cell; y: number; e: number }[] = [];
  let dropped = 0;
  xs.forEach((x, i) => {
    const y = ys[i];
    if (x == null || typeof y !== "number") return void (dropped += 1);
    const e = es?.[i];
    pts.push({ x, y, e: typeof e === "number" ? Math.abs(e) : 0 });
  });
  if (dropped) warnings.push(n(W.missingDropped, dropped));
  const logX = config.logX && uses.logX && xCol.info.type === "number";
  if (logX || config.logY) {
    const kept = pts.filter((p) => (!logX || (p.x as number) > 0) && (!config.logY || p.y > 0));
    if (kept.length < pts.length) warnings.push(n(W.logDropped, pts.length - kept.length));
    pts = kept;
  }
  if (pts.length === 0) return fail(E.noPoints);
  if (config.type === "line" && xCol.info.type !== "string") pts = [...pts].sort((a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0));
  if (config.type !== "line" && config.type !== "scatter" && xCol.info.type === "string") {
    layout.xaxis = { ...layout.xaxis, type: "category" };
  }

  const errorY = es ? { type: "data" as const, array: pts.map((p) => p.e), visible: true, color: "#334155" } : undefined;
  const main: Data =
    config.type === "bar"
      ? { type: "bar", x: pts.map((p) => p.x), y: pts.map((p) => p.y), error_y: errorY, marker: { color: "#2563eb" } }
      : {
          type: "scatter",
          mode: config.type === "line" ? "lines+markers" : "markers",
          x: pts.map((p) => p.x),
          y: pts.map((p) => p.y),
          error_y: errorY,
          marker: { color: "#2563eb", size: 8 },
          line: { color: "#2563eb", width: 2 },
          name: config.yTitle || config.y || "",
        };
  const data: Data[] = [main];
  let regression: Regression | null = null;
  if (config.trendline && uses.trendline) {
    if (xCol.info.type !== "number") warnings.push(W.trendNeedsNumber);
    else {
      regression = linearRegression(pts.map((p) => [p.x as number, p.y]));
      if (!regression) warnings.push(W.trendImpossible);
      else {
        if (logX || config.logY) warnings.push(W.trendLog);
        const xsNum = pts.map((p) => p.x as number);
        const lo = Math.min(...xsNum);
        const hi = Math.max(...xsNum);
        const r = regression;
        const label = trendLabel(r);
        data.push({
          type: "scatter",
          mode: "lines",
          x: [lo, hi],
          y: [r.slope * lo + r.intercept, r.slope * hi + r.intercept],
          line: { color: "#dc2626", width: 2, dash: "dash" },
          name: label,
          hoverinfo: "skip",
        });
        layout.annotations = [
          { xref: "paper", yref: "paper", x: 0.02, y: 0.98, xanchor: "left", yanchor: "top", showarrow: false, text: label, font: { size: 13, color: "#991b1b" } },
        ];
      }
    }
  }
  return { ok: true, data, layout, n: pts.length, regression, warnings };
}
