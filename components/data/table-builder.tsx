"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildTableGrid, buildTableNode, defaultTableOptions, MAX_TABLE_ROWS, type TableOptions } from "@/lib/data/table";
import type { DocNode } from "@/lib/editor/content";
import { messages } from "@/lib/messages";
import type { DatasetPreview } from "@/server/datasets";
import { fill } from "./insert";

const PREVIEW_ROWS = 8;

type Props = {
  data: DatasetPreview;
  captionSupported: boolean;
  onInsert: (table: DocNode, caption: string) => void;
};

/** 표 만들기: 열 선택, 소수 자릿수, 단위, 머리글 지정 (SPEC 7.3 (e)) */
export function TableBuilder({ data, captionSupported, onInsert }: Props) {
  const t = messages.data.table;
  const p = messages.data.panel;
  const all = useMemo(() => defaultTableOptions(data.columns), [data.columns]);
  const [cols, setCols] = useState(all.columns);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(all.columns.map((c) => c.index)));
  const [decimals, setDecimals] = useState<number | null>(null);
  const [headerRow, setHeaderRow] = useState(true);
  const [caption, setCaption] = useState(fill(t.defaultCaption, { name: data.dataset.name }));

  const options: TableOptions = { columns: cols.filter((c) => selected.has(c.index)), decimals, headerRow };
  const grid = buildTableGrid(data.columns, data.rows, options, PREVIEW_ROWS);
  const insertedRows = Math.min(data.rows.length, MAX_TABLE_ROWS);

  function patch(index: number, change: Partial<(typeof cols)[number]>) {
    setCols((list) => list.map((c) => (c.index === index ? { ...c, ...change } : c)));
  }

  return (
    <div className="flex flex-col gap-3" data-testid="table-builder">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">{t.columns}</legend>
        {cols.map((c) => {
          const info = data.columns[c.index];
          return (
            <div key={c.index} className="grid grid-cols-[auto_1fr_6rem] items-center gap-2">
              <input
                type="checkbox"
                aria-label={fill(t.include, { name: info.name })}
                checked={selected.has(c.index)}
                onChange={(e) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (e.target.checked) next.add(c.index);
                    else next.delete(c.index);
                    return next;
                  })
                }
              />
              <Input aria-label={fill(t.headerOf, { name: info.name })} value={c.header} onChange={(e) => patch(c.index, { header: e.target.value })} className="h-8" />
              <Input
                aria-label={fill(t.unitOf, { name: info.name })}
                placeholder={t.unit}
                value={c.unit}
                onChange={(e) => patch(c.index, { unit: e.target.value })}
                className="h-8"
              />
            </div>
          );
        })}
      </fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <Label className="flex items-center gap-2">
          {t.decimals}
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={decimals ?? ""}
            onChange={(e) => setDecimals(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">{t.decimalsKeep}</option>
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {fill(t.decimalsN, { n })}
              </option>
            ))}
          </select>
        </Label>
        <Label className="flex items-center gap-2">
          <input type="checkbox" checked={headerRow} onChange={(e) => setHeaderRow(e.target.checked)} />
          {t.headerRow}
        </Label>
      </div>
      <Label className="flex flex-col items-start gap-1.5">
        {p.captionLabel}
        <Input value={caption} onChange={(e) => setCaption(e.target.value)} className="h-8" />
        <span className="text-xs font-normal text-muted-foreground">{captionSupported ? p.captionHint : p.captionUnsupported}</span>
      </Label>
      {options.columns.length === 0 ? (
        <p role="alert" className="text-sm text-destructive">
          {t.noColumns}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{t.previewHeading}</p>
          <div className="max-h-56 overflow-auto rounded-md border">
            <table aria-label={t.previewHeading} className="w-full border-collapse text-sm">
              <thead className="bg-muted">
                <tr>
                  {grid.header.map((h, i) => (
                    <th key={i} className="border-b px-2 py-1 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.body.map((r, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    {r.map((v, j) => (
                      <td key={j} className="px-2 py-1">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            {data.rows.length > MAX_TABLE_ROWS
              ? fill(t.truncated, { max: MAX_TABLE_ROWS, rows: data.rows.length })
              : fill(t.previewNote, { shown: grid.body.length, rows: insertedRows })}
          </p>
        </div>
      )}
      <div>
        <Button
          type="button"
          size="sm"
          disabled={options.columns.length === 0}
          onClick={() => onInsert(buildTableNode(data.columns, data.rows, options), caption)}
        >
          {t.insert}
        </Button>
      </div>
    </div>
  );
}
