import { describe, expect, it } from "vitest";
import {
  captionKindForNode,
  captionPosition,
  collectNumberingItems,
  computeNumbering,
  DEFAULT_CAPTION_POSITIONS,
  formatCaptionLabel,
  formatEquationTag,
  formatRefLabel,
  numberItems,
} from "@/lib/captions";
import { cap, doc, img, mathBlock, p, table } from "../setup/editor";

const labels = (d: ReturnType<typeof doc>) => computeNumbering(d).entries.map((e) => `${e.id}=${e.captionLabel}`);

describe("번호 표시 형식", () => {
  it("그림 1. / 표 1. / 식 (1)", () => {
    expect(formatCaptionLabel("figure", 1)).toBe("그림 1.");
    expect(formatCaptionLabel("table", 1)).toBe("표 1.");
    expect(formatCaptionLabel("equation", 1)).toBe("식 (1)");
    expect(formatRefLabel("figure", 12)).toBe("그림 12");
    expect(formatRefLabel("table", 3)).toBe("표 3");
    expect(formatRefLabel("equation", 2)).toBe("식 (2)");
    expect(formatEquationTag(7)).toBe("(7)");
  });

  it("종류 이름을 바꿔 넘길 수 있다", () => {
    const en = { figure: "Fig.", table: "Table", equation: "Eq." };
    expect(formatCaptionLabel("figure", 2, en)).toBe("Fig. 2.");
    expect(formatRefLabel("equation", 2, en)).toBe("Eq. (2)");
    expect(numberItems([{ type: "caption", kind: "table", id: "t", text: "" }], en).entries[0].refLabel).toBe("Table 1");
  });
});

describe("캡션 위치 규칙", () => {
  it("기본값: 그림은 아래, 표는 위, 수식은 아래", () => {
    expect(DEFAULT_CAPTION_POSITIONS).toEqual({ figure: "below", table: "above", equation: "below" });
    expect(captionPosition("figure")).toBe("below");
    expect(captionPosition("table")).toBe("above");
  });

  it("서식 템플릿이 넘긴 규칙이 기본값보다 우선한다", () => {
    expect(captionPosition("figure", { figure: "above" })).toBe("above");
    expect(captionPosition("table", { figure: "above" })).toBe("above");
    expect(captionPosition("table", { table: "below" })).toBe("below");
  });

  it("노드 종류로 캡션 종류를 정한다", () => {
    expect(captionKindForNode("image")).toBe("figure");
    expect(captionKindForNode("table")).toBe("table");
    expect(captionKindForNode("mathBlock")).toBe("equation");
    expect(captionKindForNode("paragraph")).toBeNull();
  });
});

describe("번호 자동 부여", () => {
  it("종류별로 문서 순서대로 1부터 센다", () => {
    const d = doc(
      img(), cap("figure", "f1", "장치"),
      cap("table", "t1", "조건"), table(),
      p("본문"),
      img(), cap("figure", "f2", "결과"),
      cap("table", "t2", "측정값"), table(),
    );
    expect(labels(d)).toEqual(["f1=그림 1.", "t1=표 1.", "f2=그림 2.", "t2=표 2."]);
  });

  it("캡션이 없으면 번호도 없다", () => {
    expect(computeNumbering(doc(p("본문"), img(), table())).entries).toEqual([]);
    expect(computeNumbering({ type: "doc" }).entries).toEqual([]);
  });

  it("중간에 삽입하면 뒤의 번호가 밀린다", () => {
    const before = doc(img(), cap("figure", "a"), img(), cap("figure", "c"));
    const after = doc(img(), cap("figure", "a"), img(), cap("figure", "b"), img(), cap("figure", "c"));
    expect(labels(before)).toEqual(["a=그림 1.", "c=그림 2."]);
    expect(labels(after)).toEqual(["a=그림 1.", "b=그림 2.", "c=그림 3."]);
  });

  it("중간을 삭제하면 뒤의 번호가 당겨진다", () => {
    const after = doc(img(), cap("figure", "a"), img(), cap("figure", "c"));
    expect(computeNumbering(after).byId.get("c")?.number).toBe(2);
  });

  it("순서를 바꾸면 번호도 문서 순서를 따른다", () => {
    const d = doc(img(), cap("figure", "c"), img(), cap("figure", "a"));
    expect(labels(d)).toEqual(["c=그림 1.", "a=그림 2."]);
  });

  it("목록·인용 등 다른 블록 안에 있는 캡션도 센다", () => {
    const d = doc(
      { type: "blockquote", content: [img(), cap("figure", "in", "인용 안")] },
      img(), cap("figure", "out"),
    );
    expect(labels(d)).toEqual(["in=그림 1.", "out=그림 2."]);
  });

  it("캡션 내용은 서식을 뗀 글자로 모은다", () => {
    const d = doc({
      type: "caption",
      attrs: { kind: "figure", id: "f" },
      content: [{ type: "text", text: "굵은 ", marks: [{ type: "bold" }] }, { type: "text", text: "설명" }],
    });
    expect(computeNumbering(d).entries[0].text).toBe("굵은 설명");
  });

  it("알 수 없는 kind는 그림으로 취급한다", () => {
    const d = doc({ type: "caption", attrs: { kind: "chart", id: "x" } });
    expect(computeNumbering(d).entries[0].kind).toBe("figure");
  });

  it("번호는 문서 JSON에 저장하지 않는다 (계산해도 원본은 그대로)", () => {
    const d = doc(img(), cap("figure", "a", "설명"));
    const snapshot = JSON.stringify(d);
    computeNumbering(d);
    expect(JSON.stringify(d)).toBe(snapshot);
    expect(snapshot).not.toContain("그림 1");
  });

  it("같은 id가 둘이면 둘 다 번호를 받고, 참조는 먼저 나온 쪽을 가리킨다", () => {
    const n = computeNumbering(doc(cap("figure", "dup", "첫째"), cap("figure", "dup", "둘째")));
    expect(n.entries.map((e) => e.number)).toEqual([1, 2]);
    expect(n.byId.get("dup")?.text).toBe("첫째");
  });
});

describe("수식 번호", () => {
  it("블록 수식은 캡션이 없어도 문서 순서로 번호를 받는다", () => {
    const n = computeNumbering(doc(mathBlock("e1"), p("본문"), mathBlock("e2", "a^2")));
    expect(n.entries.map((e) => [e.id, e.captionLabel, e.latex])).toEqual([
      ["e1", "식 (1)", "E=mc^2"],
      ["e2", "식 (2)", "a^2"],
    ]);
  });

  it("수식 바로 아래의 수식 캡션은 그 수식과 번호를 함께 쓴다", () => {
    const n = computeNumbering(doc(mathBlock("e1"), cap("equation", "c1", "질량-에너지 등가"), mathBlock("e2")));
    expect(n.entries).toHaveLength(2);
    expect(n.byId.get("e1")).toBe(n.byId.get("c1"));
    expect(n.byId.get("c1")).toMatchObject({ id: "e1", ids: ["e1", "c1"], number: 1, text: "질량-에너지 등가" });
    expect(n.byId.get("e2")?.number).toBe(2);
  });

  it("수식 바로 위의 수식 캡션도 그 수식에 붙는다", () => {
    const n = computeNumbering(doc(mathBlock("e1"), p(), cap("equation", "c2", "위 캡션"), mathBlock("e2")));
    expect(n.byId.get("c2")).toMatchObject({ id: "e2", number: 2, text: "위 캡션" });
    expect(n.entries).toHaveLength(2);
  });

  it("수식 사이에 낀 캡션은 앞 수식에 붙는다", () => {
    const n = computeNumbering(doc(mathBlock("e1"), cap("equation", "c"), mathBlock("e2")));
    expect(n.byId.get("c")?.id).toBe("e1");
  });

  it("한 수식에 캡션이 둘이면 둘째는 자기 번호를 받는다", () => {
    const items = collectNumberingItems(doc(mathBlock("e1"), cap("equation", "c1")));
    const n = numberItems([...items, { type: "caption", kind: "equation", id: "c2", text: "", attachedTo: "e1" }]);
    expect(n.byId.get("c1")?.number).toBe(1);
    expect(n.byId.get("c2")?.number).toBe(2);
  });

  it("어디에도 붙지 않은 수식 캡션은 수식과 같은 줄에서 번호를 받는다", () => {
    const n = computeNumbering(doc(mathBlock("e1"), p("본문"), cap("equation", "c"), p(), mathBlock("e2")));
    expect([n.byId.get("e1")?.number, n.byId.get("c")?.number, n.byId.get("e2")?.number]).toEqual([1, 2, 3]);
  });

  it("수식 번호는 그림·표 번호와 따로 센다", () => {
    const n = computeNumbering(doc(img(), cap("figure", "f"), mathBlock("e"), cap("table", "t"), table()));
    expect(n.entries.map((e) => e.refLabel)).toEqual(["그림 1", "식 (1)", "표 1"]);
  });
});
