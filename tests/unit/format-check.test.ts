import { describe, expect, it } from "vitest";
import type { DocContent, DocNode } from "@/lib/editor/content";
import { checkFormat, fixFormat, toPt } from "@/lib/format/check";
import { FORMAT_PRESETS } from "@/lib/format/presets";
import { DEFAULT_RULES, type FormatRules } from "@/lib/format/rules";

const doc = (...content: DocNode[]): DocContent => ({ type: "doc", content });
const p = (text: string, marks?: DocNode["marks"]): DocNode => ({ type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] });
const h = (level: number, text: string, attrs: Record<string, unknown> = {}): DocNode => ({
  type: "heading",
  attrs: { level, ...attrs },
  content: [{ type: "text", text }],
});
const img: DocNode = { type: "image", attrs: { src: "data:image/png;base64,AAAA" } };
const table: DocNode = {
  type: "table",
  content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("셀")] }] }],
};
const cap = (kind: string, text: string, id = `${kind}-${text}`): DocNode => ({
  type: "caption",
  attrs: { kind, id },
  content: text ? [{ type: "text", text }] : undefined,
});
const ref = (targetId: string): DocNode => ({ type: "crossRef", attrs: { targetId } });

let seq = 0;
const opts = { newId: () => `new-${(seq += 1)}` };
const codes = (d: DocContent, rules: FormatRules = DEFAULT_RULES) => checkFormat(d, rules, opts).map((i) => i.code);

describe("서식 검사 (P2-6)", () => {
  it("규칙대로인 문서에는 문제가 없다", () => {
    const d = doc(
      h(1, "제목"),
      p("본문"),
      h(2, "방법"),
      img,
      cap("figure", "실험 장치", "f1"),
      cap("table", "측정값", "t1"),
      table,
      { type: "paragraph", content: [{ type: "text", text: "앞 " }, ref("f1"), ref("t1")] },
    );
    expect(checkFormat(d, DEFAULT_RULES)).toEqual([]);
  });

  it("글꼴·글자 크기 불일치를 찾고, 고치면 규칙 값을 따르게 표시를 지운다", () => {
    const d = doc(
      p("함초롬", [{ type: "textStyle", attrs: { fontFamily: "함초롬바탕", fontSize: null } }]),
      p("같은 글꼴", [{ type: "textStyle", attrs: { fontFamily: '"Noto Sans KR", sans-serif' } }]),
      p("크게", [{ type: "bold" }, { type: "textStyle", attrs: { fontSize: "16px" } }]),
      p("같은 크기", [{ type: "textStyle", attrs: { fontSize: "11pt" } }]),
      h(1, "제목", {}),
    );
    // 16px = 12pt (본문 11pt와 다름), 같은 글꼴의 다른 표기·같은 크기는 문제 아님
    const issues = checkFormat(d, DEFAULT_RULES);
    expect(issues.map((i) => [i.code, i.block])).toEqual([
      ["font-mismatch", 0],
      ["size-mismatch", 2],
    ]);
    expect(issues[0].params.text).toBe("함초롬");

    const fixed = fixFormat(d, DEFAULT_RULES);
    expect(fixed.fixed).toBe(2);
    expect(fixed.remaining).toEqual([]);
    expect(fixed.doc.content![0].content![0].marks).toBeUndefined();
    expect(fixed.doc.content![2].content![0].marks).toEqual([{ type: "bold" }]);
    // 원본은 바뀌지 않는다 (순수 함수)
    expect(d.content![0].content![0].marks).toHaveLength(1);
  });

  it("제목은 제목 단계 규칙(글꼴·크기)으로, 캡션은 캡션 크기로 검사한다", () => {
    const academic = FORMAT_PRESETS[1].rules; // 제목 1: Noto Serif KR 16pt 가운데
    const d = doc(
      h(1, "제목", { textAlign: "left" }),
      { ...h(2, "소제목"), content: [{ type: "text", text: "소제목", marks: [{ type: "textStyle", attrs: { fontSize: "13pt" } }] }] },
      img,
      { ...cap("figure", ""), content: [{ type: "text", text: "작은 캡션", marks: [{ type: "textStyle", attrs: { fontSize: "9pt" } }] }] },
    );
    expect(codes(d, academic)).toEqual(["heading-align"]);
    const fixed = fixFormat(d, academic);
    expect(fixed.doc.content![0].attrs).toEqual({ level: 1, textAlign: null });
    expect(fixed.remaining).toEqual([]);
  });

  it("제목 단계 건너뜀을 찾고 앞 제목의 한 단계 아래로 고친다", () => {
    const d = doc(h(1, "가"), h(3, "나"), h(4, "다"), h(2, "라"), h(4, "마"));
    const issues = checkFormat(d, DEFAULT_RULES);
    expect(issues.map((i) => [i.code, i.block, i.params.from, i.params.to])).toEqual([
      ["heading-skip", 1, "1", "3"],
      ["heading-skip", 4, "2", "4"],
    ]);
    const fixed = fixFormat(d, DEFAULT_RULES).doc;
    expect(fixed.content!.map((n) => n.attrs?.level)).toEqual([1, 2, 3, 2, 3]);
  });

  it("그림·표의 캡션 누락: 고치면 규칙의 위치(그림 아래, 표 위)에 캡션을 넣는다", () => {
    const d = doc(p("앞"), img, table, p("뒤"));
    const issues = checkFormat(d, DEFAULT_RULES);
    expect(issues.map((i) => [i.code, i.block, i.params.kind])).toEqual([
      ["caption-missing", 1, "figure"],
      ["caption-missing", 2, "table"],
    ]);
    const fixed = fixFormat(d, DEFAULT_RULES, opts);
    expect(fixed.fixed).toBe(2);
    expect(fixed.doc.content!.map((n) => (n.type === "caption" ? `caption:${n.attrs!.kind}` : n.type))).toEqual([
      "paragraph",
      "image",
      "caption:figure",
      "caption:table",
      "table",
      "paragraph",
    ]);
    expect(fixed.remaining).toEqual([]);
  });

  it("에디터에 캡션 노드가 없으면 캡션 누락은 직접 고쳐야 하는 항목으로 남는다", () => {
    const d = doc(img);
    const [issue] = checkFormat(d, DEFAULT_RULES, { canInsertCaption: false });
    expect(issue).toMatchObject({ code: "caption-missing", fixable: false });
    const fixed = fixFormat(d, DEFAULT_RULES, { canInsertCaption: false });
    expect(fixed.fixed).toBe(0);
    expect(fixed.doc).toEqual(d);
  });

  it("캡션 위치 규칙과 다르면 알리고, 고치면 캡션을 반대쪽으로 옮긴다", () => {
    const d = doc(cap("figure", "그림 위 캡션", "f1"), img, table, cap("table", "표 아래 캡션", "t1"));
    expect(codes(d)).toEqual(["caption-position", "caption-position"]);
    const fixed = fixFormat(d, DEFAULT_RULES).doc;
    expect(fixed.content!.map((n) => n.type)).toEqual(["image", "caption", "caption", "table"]);
    expect(fixed.content![1].attrs!.id).toBe("f1");
    expect(fixed.content![2].attrs!.id).toBe("t1");

    // 규칙을 "그림 캡션 위"로 바꾸면 처음 문서의 그림 캡션은 제자리다
    const above: FormatRules = { ...DEFAULT_RULES, caption: { ...DEFAULT_RULES.caption, figurePosition: "above" } };
    expect(codes(d, above)).toEqual(["caption-position"]);
  });

  it("연속된 그림에서 앞 그림의 캡션을 뒤 그림의 것으로 착각하지 않는다", () => {
    const above: FormatRules = { ...DEFAULT_RULES, caption: { ...DEFAULT_RULES.caption, figurePosition: "above" } };
    expect(codes(doc(cap("figure", "가"), img, cap("figure", "나"), img), above)).toEqual([]);
    expect(codes(doc(img, cap("figure", "가"), img, cap("figure", "나")))).toEqual([]);
    expect(codes(doc(img, cap("figure", "가"), img))).toEqual(["caption-missing"]);
  });

  it("짝이 없는 캡션, 대상이 없는 상호 참조는 직접 고쳐야 하는 항목이다", () => {
    const d = doc(cap("figure", "떠 있는 캡션"), { type: "paragraph", content: [ref("없는-id")] });
    const issues = checkFormat(d, DEFAULT_RULES);
    expect(issues.map((i) => [i.code, i.fixable])).toEqual([
      ["caption-orphan", false],
      ["broken-ref", false],
    ]);
    expect(fixFormat(d, DEFAULT_RULES).remaining).toHaveLength(2);
  });

  it("수식 캡션은 옆의 블록 수식과 짝이다", () => {
    const math: DocNode = { type: "mathBlock", attrs: { latex: "x^2", id: "e1" } };
    expect(codes(doc(math, cap("equation", "이차식", "e1c")))).toEqual([]);
    expect(codes(doc(p("x"), cap("equation", "혼자", "e2")))).toEqual(["caption-orphan"]);
  });

  it("캡션에 직접 쓴 번호가 자동 번호와 다르면(번호 건너뜀) 알리고, 고치면 직접 쓴 번호를 지운다", () => {
    const d = doc(
      img,
      cap("figure", "그림 1. 첫 그림", "f1"),
      img,
      cap("figure", "그림 3. 둘째 그림", "f2"),
      cap("table", "[표 1] 측정값", "t1"),
      table,
    );
    const issues = checkFormat(d, DEFAULT_RULES);
    expect(issues.map((i) => [i.code, i.params.written, i.params.expected])).toEqual([
      ["number-duplicate", "그림 1.", "그림 1"],
      ["number-mismatch", "그림 3.", "그림 2"],
      ["number-duplicate", "[표 1]", "표 1"],
    ]);
    const fixed = fixFormat(d, DEFAULT_RULES);
    expect([1, 3, 4].map((i) => fixed.doc.content![i].content![0].text)).toEqual(["첫 그림", "둘째 그림", "측정값"]);
    expect(fixed.remaining).toEqual([]);
  });

  it("같은 id를 쓰는 캡션은 새 id로 고친다", () => {
    const d = doc(img, cap("figure", "가", "dup"), img, cap("figure", "나", "dup"));
    expect(codes(d)).toEqual(["duplicate-id"]);
    const fixed = fixFormat(d, DEFAULT_RULES, { newId: () => "fresh" }).doc;
    expect(fixed.content!.map((n) => n.attrs?.id).filter(Boolean)).toEqual(["dup", "fresh"]);
  });

  it("목록·표 안의 문단도 검사하고, 문제 위치는 최상위 블록 순서로 알린다", () => {
    const d = doc(p("가"), {
      type: "bulletList",
      content: [{ type: "listItem", content: [p("항목", [{ type: "textStyle", attrs: { fontFamily: "Gulim" } }])] }],
    });
    expect(checkFormat(d, DEFAULT_RULES).map((i) => [i.code, i.block])).toEqual([["font-mismatch", 1]]);
  });

  it("글자 크기 단위를 pt로 바꾼다", () => {
    expect(toPt("12pt", 11)).toBe(12);
    expect(toPt("16px", 11)).toBe(12);
    expect(toPt("2em", 10)).toBe(20);
    expect(toPt("150%", 10)).toBe(15);
    expect(toPt("big", 10)).toBeNull();
  });
});
