"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { buildChart, chartCaption, chartUses, CHART_TYPES, trendLabel, type ChartConfig } from "@/lib/data/chart";
import { firstApplicableSuggestion, type ChartSuggestResponse } from "@/lib/data/chart-suggestion";
import { messages } from "@/lib/messages";
import { uploadAsset } from "@/lib/upload-client";
import type { DatasetPreview } from "@/server/datasets";
import { fill } from "./insert";

/** 문서에 넣는 그래프 이미지 크기 (px) */
const EXPORT_SIZE = { width: 720, height: 450 };

type Plotly = typeof import("plotly.js-cartesian-dist-min");
let plotlyPromise: Promise<Plotly> | null = null;
/** Plotly는 브라우저 전용이고 크므로 처음 쓸 때 불러온다. */
function loadPlotly() {
  plotlyPromise ??= import("plotly.js-cartesian-dist-min").then((m) => ((m as { default?: Plotly }).default ?? m) as Plotly);
  return plotlyPromise;
}

export type ChartImage = { src: string; alt: string; chart: ChartConfig };

type Props = {
  data: DatasetPreview;
  projectId: string;
  /** 문서의 그래프를 다시 편집할 때의 기존 설정 */
  initial: ChartConfig;
  editing: boolean;
  captionSupported: boolean;
  /** 처음 보여 줄 안내 (예: 챗봇 추천으로 열었을 때) */
  initialMessage?: string | null;
  onSubmit: (image: ChartImage, caption: string) => void;
};

/** 그래프 만들기: 유형, X·Y 열, 오차막대, 축 제목·단위, 로그 축, 추세선 → 미리보기 → SVG/PNG 삽입 */
export function ChartBuilder({ data, projectId, initial, editing, captionSupported, initialMessage, onSubmit }: Props) {
  const t = messages.data.chart;
  const p = messages.data.panel;
  const [config, setConfig] = useState<ChartConfig>(initial);
  const [caption, setCaption] = useState(() => chartCaption(initial));
  const [captionTouched, setCaptionTouched] = useState(editing);
  const [pending, setPending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [message, setMessage] = useState<string | null>(initialMessage ?? null);
  const [renderError, setRenderError] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);

  const result = useMemo(() => buildChart(config, data.columns, data.rows), [config, data]);
  const uses = chartUses(config.type);
  const numeric = data.columns.filter((c) => c.type === "number");

  function update(change: Partial<ChartConfig>) {
    const next = { ...config, ...change };
    // 열을 바꾸면 축 제목·단위를 그 열에 맞춘다 (사용자가 직접 쓴 제목·단위는 유지).
    for (const [key, title, unit] of [
      ["x", "xTitle", "xUnit"],
      ["y", "yTitle", "yUnit"],
    ] as const) {
      if (!(key in change) || next[key] === config[key] || title in change) continue;
      const before = data.columns.find((c) => c.name === config[key]);
      const after = data.columns.find((c) => c.name === next[key]);
      if (config[title] === "" || config[title] === config[key]) next[title] = "";
      if (!(unit in change) && (config[unit] === "" || config[unit] === (before?.unit ?? ""))) next[unit] = after?.unit ?? "";
    }
    setConfig(next);
    if (!captionTouched) setCaption(chartCaption(next));
  }

  useEffect(() => {
    const el = plotRef.current;
    if (!el || !result.ok) return;
    let alive = true;
    loadPlotly()
      .then((Plotly) => {
        if (!alive) return;
        setRenderError(false);
        return Plotly.react(el, result.data, { ...result.layout, autosize: true, height: 360 }, { displayModeBar: false, responsive: true });
      })
      .catch(() => alive && setRenderError(true));
    return () => {
      alive = false;
    };
  }, [result]);

  async function suggest() {
    setSuggesting(true);
    setMessage(null);
    try {
      const res = await api<ChartSuggestResponse>("/api/ai/chart-suggest", { method: "POST", body: { datasetId: data.dataset.id } });
      const picked = firstApplicableSuggestion(config, res, data.columns);
      if (!picked) throw new Error("no applicable suggestion");
      update(picked.config);
      setMessage(picked.suggestion.reason ? `${t.suggestApplied} ${picked.suggestion.reason}` : t.suggestApplied);
    } catch {
      setMessage(t.suggestUnavailable);
    } finally {
      setSuggesting(false);
    }
  }

  async function submit() {
    if (!result.ok) return;
    setPending(true);
    setMessage(null);
    try {
      const Plotly = await loadPlotly();
      const figure = { data: result.data, layout: { ...result.layout, ...EXPORT_SIZE } };
      const url = await Plotly.toImage(figure, { format: config.format, ...EXPORT_SIZE });
      let src = url;
      if (config.format === "png") {
        // PNG는 자산으로 올려 문서 JSON을 가볍게 유지한다. (SVG는 자산 형식에 없어 data URL로 넣는다.)
        const blob = await (await fetch(url)).blob();
        const asset = await uploadAsset(new File([blob], `${data.dataset.name}-chart.png`, { type: "image/png" }), { projectId });
        src = asset.url;
      }
      onSubmit({ src, alt: caption.trim() || chartCaption(config), chart: config }, caption);
    } catch {
      setMessage(t.renderFailed);
    } finally {
      setPending(false);
    }
  }

  const columnSelect = (label: string, value: string | null, onChange: (v: string | null) => void, opts: { optional?: boolean; numericOnly?: boolean }) => (
    <Label className="flex flex-col items-start gap-1">
      {label}
      <select
        className="h-8 w-full rounded-md border bg-background px-2 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      >
        {opts.optional || value == null ? <option value="">{t.none}</option> : null}
        {(opts.numericOnly ? numeric : data.columns).map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
    </Label>
  );

  const xLabel = config.type === "histogram" ? t.valueColumn : config.type === "box" ? t.groupColumn : t.x;

  return (
    <div className="flex flex-col gap-3" data-testid="chart-builder">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={suggesting} onClick={() => void suggest()}>
          {suggesting ? t.suggesting : t.suggest}
        </Button>
        {message ? (
          <span role="status" className="text-sm text-muted-foreground">
            {message}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Label className="flex flex-col items-start gap-1">
          {t.type}
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={config.type}
            onChange={(e) => update({ type: e.target.value as ChartConfig["type"] })}
          >
            {CHART_TYPES.map((k) => (
              <option key={k} value={k}>
                {t.types[k]}
              </option>
            ))}
          </select>
        </Label>
        {columnSelect(xLabel, config.x, (x) => update({ x }), { optional: config.type === "box", numericOnly: config.type === "histogram" })}
        {config.type !== "histogram"
          ? columnSelect(config.type === "box" ? t.valueColumn : t.y, config.y, (y) => update({ y }), { numericOnly: true })
          : null}
        {uses.error ? columnSelect(t.error, config.error, (error) => update({ error }), { optional: true, numericOnly: true }) : null}
        {uses.bins ? (
          <Label className="flex flex-col items-start gap-1">
            {t.bins}
            <Input
              type="number"
              min={1}
              max={200}
              placeholder={t.binsAuto}
              value={config.bins ?? ""}
              onChange={(e) => update({ bins: e.target.value === "" ? null : Math.max(1, Math.min(200, Math.round(Number(e.target.value)) || 1)) })}
              className="h-8"
            />
          </Label>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["xTitle", t.xTitle, config.x ?? ""],
            ["xUnit", t.xUnit, ""],
            ["yTitle", t.yTitle, config.type === "histogram" ? t.count : (config.y ?? "")],
            ["yUnit", t.yUnit, ""],
          ] as const
        ).map(([key, label, placeholder]) => (
          <Label key={key} className="flex flex-col items-start gap-1">
            {label}
            <Input value={config[key]} placeholder={placeholder} onChange={(e) => update({ [key]: e.target.value })} className="h-8" />
          </Label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {uses.logX ? (
          <Label className="flex items-center gap-2">
            <input type="checkbox" checked={config.logX} onChange={(e) => update({ logX: e.target.checked })} />
            {t.logX}
          </Label>
        ) : null}
        <Label className="flex items-center gap-2">
          <input type="checkbox" checked={config.logY} onChange={(e) => update({ logY: e.target.checked })} />
          {t.logY}
        </Label>
        {uses.trendline ? (
          <Label className="flex items-center gap-2">
            <input type="checkbox" checked={config.trendline} onChange={(e) => update({ trendline: e.target.checked })} />
            {t.trendline}
          </Label>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t.preview}</p>
        {result.ok ? (
          <>
            <div ref={plotRef} role="img" aria-label={t.preview} data-testid="chart-preview" className="min-h-[360px] w-full rounded-md border" />
            <p className="text-xs text-muted-foreground">{fill(t.points, { n: result.n })}</p>
            {result.regression ? (
              <p data-testid="chart-stats" className="text-sm">
                {fill(t.stats, { label: trendLabel(result.regression), n: result.regression.n })}
                <span className="ml-1 text-xs text-muted-foreground">{t.statsNote}</span>
              </p>
            ) : null}
            {result.warnings.length > 0 ? (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            {renderError ? (
              <p role="alert" className="text-sm text-destructive">
                {t.renderFailed}
              </p>
            ) : null}
          </>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            {result.error}
          </p>
        )}
      </div>
      {editing ? null : (
      <Label className="flex flex-col items-start gap-1.5">
        {p.captionLabel}
        <Input
          value={caption}
          onChange={(e) => {
            setCaptionTouched(true);
            setCaption(e.target.value);
          }}
          className="h-8"
        />
        <span className="text-xs font-normal text-muted-foreground">{captionSupported ? p.captionHint : p.captionUnsupported}</span>
      </Label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <fieldset className="flex items-center gap-3 text-sm">
          <legend className="sr-only">{t.format}</legend>
          <span>{t.format}</span>
          {(["svg", "png"] as const).map((f) => (
            <label key={f} className="flex items-center gap-1">
              <input type="radio" name="chart-format" value={f} checked={config.format === f} onChange={() => update({ format: f })} />
              {f === "svg" ? t.formatSvg : t.formatPng}
            </label>
          ))}
        </fieldset>
        <Button type="button" size="sm" disabled={!result.ok || pending} onClick={() => void submit()}>
          {pending ? t.inserting : editing ? t.update : t.insert}
        </Button>
        <span className="text-xs text-muted-foreground">{t.editHint}</span>
      </div>
    </div>
  );
}
