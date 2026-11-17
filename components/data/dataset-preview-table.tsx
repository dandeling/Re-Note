import type { ColumnInfo } from "@/lib/csv/parse";
import { messages } from "@/lib/messages";

type Props = { label: string; columns: ColumnInfo[]; rows: string[][] };

/** 데이터셋 원본 행 미리보기 (머리글에 추론한 열 타입·단위 표시) */
export function DatasetPreviewTable({ label, columns, rows }: Props) {
  const t = messages.data;
  return (
    <div className="max-h-72 overflow-auto rounded-md border">
      <table aria-label={label} className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.name} scope="col" className="border-b px-2 py-1.5 text-left font-semibold">
                {c.name}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {t.columnType[c.type]}
                  {c.unit ? ` · ${c.unit}` : ""}
                  {c.missing > 0 ? ` · ${t.missingCount.replace("{n}", String(c.missing))}` : ""}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-b-0">
              {row.map((cell, j) => (
                <td key={j} className={columns[j]?.type === "number" ? "px-2 py-1 text-right tabular-nums" : "px-2 py-1"}>
                  {cell === "" ? <span className="text-muted-foreground">{t.missingCell}</span> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
