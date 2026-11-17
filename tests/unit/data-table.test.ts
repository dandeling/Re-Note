import { readFileSync } from "node:fs";
import path from "node:path";
import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv/parse";
import { captionNode, newCaptionId, withCaption } from "@/lib/data/doc-nodes";
import { buildTableGrid, buildTableNode, cellText, defaultTableOptions } from "@/lib/data/table";
import { docToText, type DocNode } from "@/lib/editor/content";
import { documentExtensions } from "@/lib/editor/extensions";

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, "../fixtures/csv", name)));
const schema = getSchema(documentExtensions());

describe("표 만들기 (P4-2)", () => {
  const csv = parseCsv(fixture("korean-cp949.csv"));

  it("기본 옵션은 모든 열, 머리글은 열 이름, 단위는 추론한 단위", () => {
    const opts = defaultTableOptions(csv.columns);
    expect(opts.columns.map((c) => c.header)).toEqual(["시간(s)", "진폭", "온도", "비고"]);
    expect(opts.columns[1].unit).toBe("mm");
    const grid = buildTableGrid(csv.columns, csv.rows, opts);
    expect(grid.header).toEqual(["시간(s)", "진폭 (mm)", "온도", "비고"]);
    // 단위는 머리글로 옮기고 칸에서는 뗀다. 결측은 빈 칸.
    expect(grid.body[0]).toEqual(["0", "12.5", "21.3", "시작"]);
    expect(grid.body[2]).toEqual(["2", "8.3", "", "감쇠 구간"]);
  });

  it("열 선택·머리글·단위·소수 자릿수를 반영한다", () => {
    const grid = buildTableGrid(csv.columns, csv.rows, {
      columns: [
        { index: 1, header: "변위", unit: "밀리미터" },
        { index: 3, header: "", unit: "" },
      ],
      decimals: 2,
      headerRow: true,
    });
    expect(grid.header).toEqual(["변위 (밀리미터)", "비고"]);
    expect(grid.body[0]).toEqual(["12.50", "시작"]);
  });

  it("숫자 칸 표기: 원본 유지, 천 단위 구분, 숫자가 아닌 값", () => {
    const num = { name: "x", type: "number" as const, unit: "g", missing: 0 };
    expect(cellText("1,200 g", num, null)).toBe("1,200");
    expect(cellText("1,200 g", num, 1)).toBe("1200.0");
    expect(cellText("2.0", num, null)).toBe("2.0");
    expect(cellText("", num, 2)).toBe("");
    expect(cellText("측정 불가", num, 2)).toBe("측정 불가");
    expect(cellText("3.14159", { ...num, type: "string" }, 2)).toBe("3.14159");
  });

  it("에디터 스키마에 맞는 table 노드를 만든다 (머리글 칸 지정 포함)", () => {
    const opts = defaultTableOptions(csv.columns);
    const node = buildTableNode(csv.columns, csv.rows, opts);
    expect(() => schema.nodeFromJSON(node).check()).not.toThrow();
    expect(node.content).toHaveLength(1 + csv.rowCount);
    expect(node.content![0].content![0].type).toBe("tableHeader");
    const plain = buildTableNode(csv.columns, csv.rows, { ...opts, headerRow: false });
    expect(plain.content![0].content![0].type).toBe("tableCell");
    expect(() => buildTableNode(csv.columns, csv.rows, { ...opts, columns: [] })).toThrow();
  });

  it("행이 많으면 maxRows까지만 넣는다", () => {
    const node = buildTableNode(csv.columns, csv.rows, defaultTableOptions(csv.columns), 2);
    expect(node.content).toHaveLength(3);
    expect(buildTableGrid(csv.columns, csv.rows, defaultTableOptions(csv.columns), 2).truncated).toBe(true);
  });
});

describe("캡션 조각 (문서 노드 계약)", () => {
  const body: DocNode = { type: "paragraph" };

  it("표는 캡션이 위, 그림은 캡션이 아래", () => {
    expect(withCaption(body, { kind: "table", id: "tbl-1", text: "실험 결과" })).toEqual([
      { type: "caption", attrs: { kind: "table", id: "tbl-1" }, content: [{ type: "text", text: "실험 결과" }] },
      body,
    ]);
    const fig = withCaption(body, { kind: "figure", id: "fig-1", text: "산점도" });
    expect(fig[0]).toBe(body);
    expect(fig[1]).toMatchObject({ type: "caption", attrs: { kind: "figure", id: "fig-1" } });
  });

  it("caption 노드가 없는 스키마에서는 본체만 넣는다", () => {
    expect(withCaption(body, null)).toEqual([body]);
  });

  it("빈 캡션은 텍스트 없이 만들고, id는 종류별 접두사를 가진다", () => {
    expect(captionNode("figure", "fig-x", "  ")).toEqual({ type: "caption", attrs: { kind: "figure", id: "fig-x" } });
    expect(newCaptionId("figure")).toMatch(/^fig-[0-9a-z]{8}$/);
    expect(newCaptionId("table", () => 0)).toBe("tbl-00000000");
    expect(newCaptionId("table")).not.toBe(newCaptionId("table"));
  });
});

describe("P4-4: CP949 한글 CSV → 표", () => {
  it("CP949와 UTF-8(BOM) 파일로 만든 표가 같고 한글이 깨지지 않는다", () => {
    const a = parseCsv(fixture("korean-cp949.csv"));
    const b = parseCsv(fixture("korean-utf8-bom.csv"));
    const ta = buildTableNode(a.columns, a.rows, defaultTableOptions(a.columns));
    const tb = buildTableNode(b.columns, b.rows, defaultTableOptions(b.columns));
    expect(ta).toEqual(tb);
    const text = docToText({ type: "doc", content: [ta] });
    expect(text).toContain("감쇠 구간");
    expect(text).toContain("진폭 (mm)");
    expect(text).not.toContain("�");
  });

  it("결측값과 단위가 섞인 열도 표로 만든다", () => {
    const m = parseCsv(fixture("missing.csv"));
    const grid = buildTableGrid(m.columns, m.rows, defaultTableOptions(m.columns));
    expect(grid.body[1]).toEqual(["2", "", "b"]);
    expect(grid.body[5]).toEqual(["", "12.1", "f"]);

    const u = parseCsv(fixture("mixed-units.csv"));
    const node = buildTableNode(u.columns, u.rows, { ...defaultTableOptions(u.columns), decimals: 0 });
    expect(() => schema.nodeFromJSON(node).check()).not.toThrow();
    const ug = buildTableGrid(u.columns, u.rows, { ...defaultTableOptions(u.columns), decimals: 0 });
    // 단위가 섞인 "길이"는 문자 열이라 원본 그대로, "질량"은 숫자 열이라 단위를 떼고 반올림
    expect(ug.header).toEqual(["시료", "길이", "질량 (g)", "측정일"]);
    expect(ug.body[0]).toEqual(["A", "12.5 cm", "1200", "2026-03-01"]);
  });
});
