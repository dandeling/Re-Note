import Papa from "papaparse";

export type ColumnType = "number" | "date" | "string";

export type ColumnInfo = {
  name: string;
  type: ColumnType;
  /** 숫자 열에서 값에 공통으로 붙어 있던 단위 (예: "cm"). 섞여 있으면 null */
  unit: string | null;
  /** 비어 있거나 결측 표기(NA, -, 등)인 칸 수 */
  missing: number;
};

export type ParsedCsv = {
  encoding: "utf-8" | "euc-kr";
  columns: ColumnInfo[];
  /** 원본 문자열 그대로의 행 (머리글 제외). 결측은 빈 문자열 */
  rows: string[][];
  rowCount: number;
  warnings: string[];
};

const MISSING = new Set(["", "na", "n/a", "nan", "null", "-", "--", "결측", "없음", "#n/a"]);

export function isMissing(value: string | undefined | null) {
  return value == null || MISSING.has(value.trim().toLowerCase());
}

/**
 * 인코딩 자동 감지: BOM → UTF-8 엄격 디코딩 시도 → 실패하면 EUC-KR(CP949).
 * (한국어 엑셀이 저장한 CSV는 대개 CP949다.)
 */
export function decodeCsv(bytes: Uint8Array): { text: string; encoding: "utf-8" | "euc-kr" } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" };
  }
}

const NUMBER_RE = /^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?|[+-]?\.\d+)\s*([^\d\s.,+-][^\d\s]*)?$/;

/**
 * "1,234.5", "12.5 cm", "30%", "-3e-2" 같은 표기에서 숫자와 단위를 분리한다. 숫자가 아니면 null.
 */
export function parseNumber(raw: string): { value: number; unit: string | null } | null {
  const s = raw.trim().replace(/−/g, "-");
  const m = NUMBER_RE.exec(s);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return { value, unit: m[2] ?? null };
}

const DATE_RES = [
  /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/,
];

/** 날짜 문자열을 epoch ms로. 날짜가 아니면 null. */
export function parseDate(raw: string): number | null {
  const s = raw.trim();
  for (const re of DATE_RES) {
    const m = re.exec(s);
    if (!m) continue;
    const [y, mo, d, h = "0", mi = "0", se = "0"] = m.slice(1).map((x) => x ?? "0");
    const month = Number(mo);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const t = Date.UTC(Number(y), month - 1, day, Number(h), Number(mi), Number(se));
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** 열 타입 추론: 결측을 뺀 값이 모두 숫자면 number, 모두 날짜면 date, 아니면 string */
export function inferColumn(name: string, values: string[]): ColumnInfo {
  const present = values.filter((v) => !isMissing(v));
  const missing = values.length - present.length;
  if (present.length === 0) return { name, type: "string", unit: null, missing };

  const numbers = present.map(parseNumber);
  if (numbers.every((n) => n !== null)) {
    const units = new Set(numbers.map((n) => n!.unit ?? ""));
    units.delete("");
    // 단위가 하나로 통일돼 있으면 그 단위를 열의 단위로 본다. 여러 단위가 섞였으면 숫자로 다룰 수 없다.
    if (units.size <= 1) return { name, type: "number", unit: [...units][0] ?? null, missing };
    return { name, type: "string", unit: null, missing };
  }
  if (present.every((v) => parseDate(v) !== null)) return { name, type: "date", unit: null, missing };
  return { name, type: "string", unit: null, missing };
}

/** 숫자 열의 값을 숫자 배열로 (결측·비숫자는 null) */
export function numericValues(values: string[]): (number | null)[] {
  return values.map((v) => (isMissing(v) ? null : (parseNumber(v)?.value ?? null)));
}

export const MAX_CSV_ROWS = 100_000;
export const MAX_CSV_COLUMNS = 200;

export class CsvError extends Error {}

/** CSV 바이트를 읽어 열 정보와 행으로 바꾼다. 첫 행은 머리글. */
export function parseCsv(bytes: Uint8Array): ParsedCsv {
  const { text, encoding } = decodeCsv(bytes);
  const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const data = result.data;
  if (data.length === 0) throw new CsvError("빈 CSV 파일입니다.");

  const warnings: string[] = [];
  const header = data[0].map((h, i) => h.trim() || `열${i + 1}`);
  if (header.length > MAX_CSV_COLUMNS) throw new CsvError(`열이 너무 많습니다 (최대 ${MAX_CSV_COLUMNS}개).`);
  // 같은 이름의 열은 뒤에 번호를 붙여 구분한다.
  const seen = new Map<string, number>();
  const names = header.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });

  let body = data.slice(1);
  if (body.length > MAX_CSV_ROWS) {
    warnings.push(`행이 ${MAX_CSV_ROWS.toLocaleString("ko-KR")}개를 넘어 앞부분만 사용합니다.`);
    body = body.slice(0, MAX_CSV_ROWS);
  }
  let ragged = 0;
  const rows = body.map((r) => {
    if (r.length !== names.length) ragged += 1;
    return names.map((_, i) => (isMissing(r[i]) ? "" : r[i].trim()));
  });
  if (ragged > 0) warnings.push(`열 개수가 머리글과 다른 행이 ${ragged}개 있어 빈 칸으로 맞췄습니다.`);

  const columns = names.map((name, i) => inferColumn(name, rows.map((r) => r[i])));
  for (const c of columns) {
    if (c.type === "string") {
      const col = rows.map((r) => r[columns.indexOf(c)]).filter((v) => v !== "");
      const nums = col.map(parseNumber).filter((n) => n !== null);
      if (nums.length === col.length && col.length > 0) {
        warnings.push(`"${c.name}" 열에 단위가 섞여 있어 문자로 처리했습니다.`);
      }
    }
  }
  return { encoding, columns, rows, rowCount: rows.length, warnings };
}
