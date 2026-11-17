import { parseNumber, type ColumnInfo } from "@/lib/csv/parse";
import { formatNumber } from "@/lib/csv/stats";
import type { DocNode } from "@/lib/editor/content";

/** 표로 넣을 수 있는 최대 데이터 행 수 (문서가 지나치게 커지지 않게) */
export const MAX_TABLE_ROWS = 500;

export type TableColumnOption = {
  /** 데이터셋 열 번호 */
  index: number;
  /** 머리글 문구 (비우면 열 이름) */
  header: string;
  /** 머리글에 붙일 단위 (예: "mm" → "진폭 (mm)"). 비우면 붙이지 않음 */
  unit: string;
};

export type TableOptions = {
  columns: TableColumnOption[];
  /** 숫자 열의 소수 자릿수. null이면 원본 표기 그대로 */
  decimals: number | null;
  /** 첫 행을 머리글 칸(tableHeader)으로 */
  headerRow: boolean;
};

/** 열마다 기본 옵션: 모든 열, 머리글 = 열 이름, 단위 = 추론한 단위 */
export function defaultTableOptions(columns: ColumnInfo[]): TableOptions {
  return {
    columns: columns.map((c, index) => ({ index, header: c.name, unit: c.unit ?? "" })),
    decimals: null,
    headerRow: true,
  };
}

export function headerText(col: TableColumnOption, info: ColumnInfo | undefined) {
  const name = col.header.trim() || info?.name || "";
  const unit = col.unit.trim();
  return unit ? `${name} (${unit})` : name;
}

/**
 * 칸 표기. 숫자 열은 단위를 떼고(단위는 머리글로) 소수 자릿수를 맞춘다.
 * 결측은 빈 칸. 숫자로 읽히지 않는 값은 원본 그대로 둔다.
 */
export function cellText(raw: string, info: ColumnInfo | undefined, decimals: number | null) {
  if (raw === "") return "";
  if (info?.type !== "number") return raw;
  const parsed = parseNumber(raw);
  if (!parsed) return raw;
  if (decimals != null) return formatNumber(parsed.value, decimals);
  if (!parsed.unit) return raw.trim();
  const s = raw.trim();
  return s.slice(0, s.lastIndexOf(parsed.unit)).trim();
}

/** 화면 미리보기와 문서 삽입에 함께 쓰는 문자열 표 */
export function buildTableGrid(columns: ColumnInfo[], rows: string[][], options: TableOptions, maxRows = MAX_TABLE_ROWS) {
  const header = options.columns.map((c) => headerText(c, columns[c.index]));
  const body = rows.slice(0, maxRows).map((r) => options.columns.map((c) => cellText(r[c.index] ?? "", columns[c.index], options.decimals)));
  return { header, body, truncated: rows.length > maxRows };
}

function cell(type: "tableHeader" | "tableCell", text: string): DocNode {
  return { type, content: [text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" }] };
}

/** Tiptap `table` 노드 JSON */
export function buildTableNode(columns: ColumnInfo[], rows: string[][], options: TableOptions, maxRows = MAX_TABLE_ROWS): DocNode {
  if (options.columns.length === 0) throw new Error("열을 하나 이상 선택해야 합니다.");
  const grid = buildTableGrid(columns, rows, options, maxRows);
  return {
    type: "table",
    content: [
      { type: "tableRow", content: grid.header.map((h) => cell(options.headerRow ? "tableHeader" : "tableCell", h)) },
      ...grid.body.map((r) => ({ type: "tableRow", content: r.map((v) => cell("tableCell", v)) })),
    ],
  };
}
