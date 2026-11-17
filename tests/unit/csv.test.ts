import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeCsv, inferColumn, numericValues, parseCsv, parseDate, parseNumber } from "@/lib/csv/parse";
import { boxStats, formatNumber, histogram, linearRegression, pairs, quantile, stdev } from "@/lib/csv/stats";

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, "../fixtures/csv", name)));

describe("CSV 인코딩 감지", () => {
  it("CP949(EUC-KR)로 저장된 한글 CSV가 깨지지 않는다", () => {
    const parsed = parseCsv(fixture("korean-cp949.csv"));
    expect(parsed.encoding).toBe("euc-kr");
    expect(parsed.columns.map((c) => c.name)).toEqual(["시간(s)", "진폭", "온도", "비고"]);
    expect(parsed.rows[2][3]).toBe("감쇠 구간");
    expect(JSON.stringify(parsed)).not.toContain("�");
  });
  it("UTF-8(BOM 포함)도 같은 결과를 낸다", () => {
    const a = parseCsv(fixture("korean-cp949.csv"));
    const b = parseCsv(fixture("korean-utf8-bom.csv"));
    expect(b.encoding).toBe("utf-8");
    expect(b.columns).toEqual(a.columns);
    expect(b.rows).toEqual(a.rows);
  });
  it("BOM 없는 UTF-8 한글도 UTF-8로 판정한다", () => {
    expect(decodeCsv(new TextEncoder().encode("가,나\n1,2")).encoding).toBe("utf-8");
  });
});

describe("열 타입 추론", () => {
  it("숫자·단위·결측을 인식한다", () => {
    const { columns } = parseCsv(fixture("korean-cp949.csv"));
    expect(columns[0]).toMatchObject({ type: "number", unit: null, missing: 0 });
    expect(columns[1]).toMatchObject({ type: "number", unit: "mm" });
    expect(columns[2]).toMatchObject({ type: "number", missing: 1 });
    expect(columns[3]).toMatchObject({ type: "string", missing: 2 });
  });
  it("결측값(빈 칸, NA, -)은 타입 추론에서 빼고 개수를 센다", () => {
    const parsed = parseCsv(fixture("missing.csv"));
    expect(parsed.columns[0]).toMatchObject({ type: "number", missing: 1 });
    expect(parsed.columns[1]).toMatchObject({ type: "number", missing: 2 });
    expect(numericValues(parsed.rows.map((r) => r[1]))).toEqual([2, null, 6.1, null, 10.2, 12.1]);
  });
  it("단위가 섞인 열은 숫자로 다루지 않고 경고한다", () => {
    const parsed = parseCsv(fixture("mixed-units.csv"));
    const byName = Object.fromEntries(parsed.columns.map((c) => [c.name, c]));
    expect(byName["길이"].type).toBe("string");
    expect(byName["질량"]).toMatchObject({ type: "number", unit: "g" });
    expect(byName["측정일"].type).toBe("date");
    expect(parsed.warnings.join(" ")).toContain("길이");
  });
  it("모든 값이 결측이면 문자 열", () => {
    expect(inferColumn("x", ["", "NA", "-"])).toMatchObject({ type: "string", missing: 3 });
  });
});

describe("parseNumber / parseDate", () => {
  it.each([
    ["1,234.5", 1234.5, null],
    ["12.5 cm", 12.5, "cm"],
    ["30%", 30, "%"],
    ["-3e-2", -0.03, null],
    ["−4.2", -4.2, null],
    [".5", 0.5, null],
    ["25℃", 25, "℃"],
  ])("%s", (raw, value, unit) => {
    expect(parseNumber(raw)).toEqual({ value, unit });
  });
  it.each(["abc", "12 34", "1.2.3", "", "2026-03-01"])("숫자가 아님: %s", (raw) => {
    expect(parseNumber(raw)).toBeNull();
  });
  it("날짜 형식", () => {
    expect(parseDate("2026-03-01")).toBe(Date.UTC(2026, 2, 1));
    expect(parseDate("2026.3.1")).toBe(Date.UTC(2026, 2, 1));
    expect(parseDate("2026년 3월 1일")).toBe(Date.UTC(2026, 2, 1));
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("3월")).toBeNull();
  });
});

describe("CSV 구조 처리", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("따옴표 안의 쉼표·줄바꿈을 처리한다", () => {
    const parsed = parseCsv(enc('이름,메모\n"홍, 길동","첫 줄\n둘째 줄"\n'));
    expect(parsed.rows).toEqual([["홍, 길동", "첫 줄\n둘째 줄"]]);
  });
  it("빈 머리글·중복 머리글에 이름을 붙인다", () => {
    const parsed = parseCsv(enc("a,,a\n1,2,3\n"));
    expect(parsed.columns.map((c) => c.name)).toEqual(["a", "열2", "a (2)"]);
  });
  it("열 개수가 맞지 않는 행은 빈 칸으로 맞추고 경고한다", () => {
    const parsed = parseCsv(enc("a,b,c\n1,2\n1,2,3,4\n"));
    expect(parsed.rows).toEqual([["1", "2", ""], ["1", "2", "3"]]);
    expect(parsed.warnings).toHaveLength(1);
  });
  it("빈 파일은 오류", () => {
    expect(() => parseCsv(enc(""))).toThrow();
  });
});

describe("수치 계산 (코드로 결정적으로 수행)", () => {
  it("완벽한 직선: 기울기·절편·R²=1", () => {
    const r = linearRegression([[0, 1], [1, 3], [2, 5], [3, 7]])!;
    expect(r.slope).toBeCloseTo(2, 12);
    expect(r.intercept).toBeCloseTo(1, 12);
    expect(r.r2).toBeCloseTo(1, 12);
  });
  it("알려진 데이터셋의 회귀값과 일치한다", () => {
    // x=[1..5], y=[2.2,4.1,6.2,7.9,10.1] → slope 1.96, intercept 0.22, R² 0.998856 (= 19.6² / (10 × 38.46))
    const r = linearRegression(pairs([1, 2, 3, 4, 5], [2.2, 4.1, 6.2, 7.9, 10.1]))!;
    expect(r.slope).toBeCloseTo(1.96, 10);
    expect(r.intercept).toBeCloseTo(0.22, 10);
    expect(r.r2).toBeCloseTo(0.998856, 5);
    expect(r.n).toBe(5);
  });
  it("상관이 없으면 R²가 0에 가깝다", () => {
    expect(linearRegression([[1, 1], [2, -1], [3, 1], [4, -1], [5, 1]])!.r2).toBeLessThan(0.01);
  });
  it("결측이 있는 쌍은 빼고 계산한다", () => {
    expect(pairs([1, null, 3, 4], [2, 5, null, 8])).toEqual([[1, 2], [4, 8]]);
  });
  it("점이 부족하거나 x가 모두 같으면 null", () => {
    expect(linearRegression([[1, 1]])).toBeNull();
    expect(linearRegression([[2, 1], [2, 5]])).toBeNull();
  });
  it("분위수·상자그림 통계", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 100];
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    const b = boxStats(s)!;
    expect(b).toMatchObject({ min: 1, q1: 3, median: 5, q3: 7, max: 100, whiskerLow: 1, whiskerHigh: 8 });
    expect(b.outliers).toEqual([100]);
  });
  it("히스토그램 구간의 개수 합은 값의 개수와 같다", () => {
    const values = [1, 1, 2, 3, 5, 8, 13, 21];
    const bins = histogram(values, 4);
    expect(bins).toHaveLength(4);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(values.length);
    expect(bins[0]).toMatchObject({ start: 1, end: 6, count: 5 });
    expect(histogram([3, 3, 3])).toEqual([{ start: 3, end: 3, count: 3 }]);
  });
  it("표준편차와 소수 자릿수 표시", () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
    expect(formatNumber(3.14159, 2)).toBe("3.14");
    expect(formatNumber(2, 1)).toBe("2.0");
  });
});
