"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { MAX_CSV_ROWS } from "@/lib/csv/parse";
import { chartConfigSchema, defaultChartConfig, type ChartConfig } from "@/lib/data/chart";
import { CHART_SUGGESTION_EVENT, type ChartSuggestionRequest } from "@/lib/data/chart-request";
import { chartConfigFromSuggestion } from "@/lib/data/chart-suggestion";
import { chartImageNode } from "@/lib/data/doc-nodes";
import { messages } from "@/lib/messages";
import type { DatasetPreview, DatasetSummary } from "@/server/datasets";
import { ChartBuilder, type ChartImage } from "./chart-builder";
import { hasCaptionNode, insertWithCaption } from "./insert";
import { TableBuilder } from "./table-builder";

type Mode = "table" | "chart";

/** 문서에서 더블클릭한 그래프 (설정 다시 편집) */
type Editing = { pos: number; datasetId: string; config: ChartConfig };

/** 챗봇의 그래프 추천으로 연 경우 (seq: 같은 추천을 다시 열어도 새로 채우기 위한 번호) */
type Suggested = ChartSuggestionRequest & { seq: number };

type Props = { editor: Editor; projectId: string };

/** 더블클릭한 <img>가 데이터셋과 연결된 그래프면 그 위치와 설정을 돌려준다. */
function chartAt(editor: Editor, target: EventTarget | null): Editing | null {
  if (!(target instanceof HTMLImageElement)) return null;
  let pos: number;
  try {
    pos = editor.view.posAtDOM(target, 0);
  } catch {
    return null;
  }
  for (const p of [pos, pos - 1]) {
    const node = p >= 0 ? editor.state.doc.nodeAt(p) : null;
    if (node?.type.name !== "image" || !node.attrs.datasetId) continue;
    const config = chartConfigSchema.safeParse(node.attrs.chart);
    if (config.success) return { pos: p, datasetId: String(node.attrs.datasetId), config: config.data };
  }
  return null;
}

/** 에디터 위의 데이터 도구: 프로젝트의 CSV 데이터로 표·그래프를 만들어 문서에 넣는다 (SPEC 7.3 (e)). */
export function DataTools({ editor, projectId }: Props) {
  const t = messages.data;
  const p = t.panel;
  const [mode, setMode] = useState<Mode | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null);
  const [datasetId, setDatasetId] = useState("");
  const [data, setData] = useState<DatasetPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<Suggested | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // 패널을 처음 열 때 프로젝트의 데이터셋 목록을 읽는다.
  useEffect(() => {
    if (!mode || datasets) return;
    let alive = true;
    api<{ datasets: DatasetSummary[] }>(`/api/datasets?projectId=${encodeURIComponent(projectId)}`)
      .then((res) => {
        if (!alive) return;
        setDatasets(res.datasets);
        if (res.datasets.length > 0) setDatasetId((id) => id || res.datasets[0].id);
      })
      .catch(() => alive && setError(t.loadFailed));
    return () => {
      alive = false;
    };
  }, [mode, datasets, projectId, t.loadFailed]);

  // 표·그래프는 전체 행으로 만든다 (행은 서버에서 원본 CSV를 다시 읽어 돌려준다).
  useEffect(() => {
    if (!mode || !datasetId || data?.dataset.id === datasetId) return;
    let alive = true;
    api<DatasetPreview>(`/api/datasets/${datasetId}/preview?limit=${MAX_CSV_ROWS}`)
      .then((res) => alive && setData(res))
      .catch(() => alive && setError(editing ? t.chart.sourceMissing : t.loadFailed));
    return () => {
      alive = false;
    };
  }, [mode, datasetId, data, editing, t.loadFailed, t.chart.sourceMissing]);

  // 문서의 그래프를 더블클릭하면 그 설정으로 그래프 패널을 연다.
  useEffect(() => {
    const dom = editor.view.dom;
    const onDblClick = (e: MouseEvent) => {
      const found = chartAt(editor, e.target);
      if (!found) return;
      e.preventDefault();
      setNotice(null);
      setError(null);
      setEditing(found);
      setDatasetId(found.datasetId);
      setMode("chart");
    };
    dom.addEventListener("dblclick", onDblClick);
    return () => dom.removeEventListener("dblclick", onDblClick);
  }, [editor]);

  // 챗봇의 그래프 추천에서 "삽입"을 누르면 그 추천으로 그래프 만들기를 연다.
  useEffect(() => {
    const onSuggestion = (e: Event) => {
      const detail = (e as CustomEvent<ChartSuggestionRequest>).detail;
      if (!detail?.datasetId || !detail.suggestion) return;
      setNotice(null);
      setError(null);
      setEditing(null);
      setDatasetId(detail.datasetId);
      setSuggested((prev) => ({ ...detail, seq: (prev?.seq ?? 0) + 1 }));
      setMode("chart");
      requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: "nearest" }));
    };
    window.addEventListener(CHART_SUGGESTION_EVENT, onSuggestion);
    return () => window.removeEventListener(CHART_SUGGESTION_EVENT, onSuggestion);
  }, []);

  function open(next: Mode) {
    setNotice(null);
    setError(null);
    setEditing(null);
    setSuggested(null);
    setMode((m) => (m === next ? null : next));
  }

  function close() {
    setMode(null);
    setEditing(null);
    setSuggested(null);
  }

  function done(ok: boolean) {
    setNotice(ok ? p.inserted : p.insertFailed);
    if (ok) close();
  }

  function submitChart(image: ChartImage, caption: string) {
    if (editing) {
      const node = editor.state.doc.nodeAt(editing.pos);
      if (node?.type.name === "image" && node.attrs.datasetId === editing.datasetId) {
        done(
          editor
            .chain()
            .focus()
            .command(({ tr }) => {
              tr.setNodeMarkup(editing.pos, undefined, { ...node.attrs, src: image.src, alt: image.alt, chart: image.chart });
              return true;
            })
            .run(),
        );
        return;
      }
    }
    const body = chartImageNode({ src: image.src, alt: image.alt, datasetId: datasetId, chart: image.chart });
    done(insertWithCaption(editor, body, { kind: "figure", text: caption }));
  }

  const captionSupported = hasCaptionNode(editor);
  const heading = mode === "table" ? t.table.heading : editing ? t.chart.editHeading : t.chart.heading;
  const ready = data && data.dataset.id === datasetId ? data : null;
  const knownDataset = (!editing && !suggested) || datasets === null || datasets.some((d) => d.id === datasetId);
  const fromSuggestion =
    ready && mode === "chart" && suggested?.datasetId === ready.dataset.id
      ? chartConfigFromSuggestion(defaultChartConfig(ready.columns), suggested.suggestion, ready.columns)
      : null;

  return (
    <div className="flex flex-col gap-2">
      <div role="toolbar" aria-label={p.label} className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={mode === "table" ? "default" : "outline"} aria-expanded={mode === "table"} onClick={() => open("table")}>
          {p.makeTable}
        </Button>
        <Button type="button" size="sm" variant={mode === "chart" ? "default" : "outline"} aria-expanded={mode === "chart"} onClick={() => open("chart")}>
          {p.makeChart}
        </Button>
        {notice ? (
          <span role="status" className="text-sm text-muted-foreground">
            {notice}
          </span>
        ) : null}
      </div>
      {mode ? (
        <section ref={sectionRef} aria-label={heading} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">{heading}</h2>
            <Button type="button" size="sm" variant="ghost" onClick={close}>
              {p.close}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : datasets === null ? (
            <p className="text-sm text-muted-foreground">{p.loading}</p>
          ) : !knownDataset ? (
            <p role="alert" className="text-sm text-destructive">
              {t.chart.sourceMissing}
            </p>
          ) : datasets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{p.noDatasets}</p>
          ) : (
            <>
              <Label className="flex items-center gap-2">
                {p.dataset}
                <select
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  value={datasetId}
                  disabled={Boolean(editing)}
                  onChange={(e) => setDatasetId(e.target.value)}
                >
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Label>
              {!ready ? (
                <p className="text-sm text-muted-foreground">{p.loading}</p>
              ) : mode === "table" ? (
                <TableBuilder
                  key={ready.dataset.id}
                  data={ready}
                  captionSupported={captionSupported}
                  onInsert={(table, caption) => done(insertWithCaption(editor, table, { kind: "table", text: caption }))}
                />
              ) : (
                <ChartBuilder
                  key={`${ready.dataset.id}:${editing?.pos ?? "new"}:${fromSuggestion ? suggested?.seq : 0}`}
                  data={ready}
                  projectId={projectId}
                  initial={editing?.config ?? fromSuggestion ?? defaultChartConfig(ready.columns)}
                  initialMessage={
                    fromSuggestion && suggested
                      ? [t.chart.suggestFromChat, suggested.suggestion.reason].filter(Boolean).join(" ")
                      : suggested && !editing
                        ? t.chart.suggestUnavailable
                        : null
                  }
                  editing={Boolean(editing)}
                  captionSupported={captionSupported}
                  onSubmit={submitChart}
                />
              )}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
