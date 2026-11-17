import { describe, expect, it } from "vitest";
import { buildCaptionList, captionListLine, captionListTitle, computeNumbering, materializeNumbering } from "@/lib/captions";
import { docContentSchema } from "@/lib/editor/content";
import { cap, captionList, doc, headlessEditor, img, mathBlock, p, ref, table } from "../setup/editor";

const sample = () =>
  doc(
    captionList("figure"),
    captionList("table"),
    img(), cap("figure", "f1", "실험 장치"),
    cap("table", "t1", "측정 조건"), table(),
    img(), cap("figure", "f2", "  감쇠 곡선  "),
    img(), cap("figure", "f3"),
    mathBlock("e1", "F=ma"),
    p(ref("f2"), "와 ", ref("gone")),
  );

describe("그림 목차 / 표 목차", () => {
  it("종류별로 문서 순서대로 항목을 만든다", () => {
    const numbering = computeNumbering(sample());
    expect(buildCaptionList(numbering, "figure")).toEqual([
      { id: "f1", number: 1, label: "그림 1.", text: "실험 장치" },
      { id: "f2", number: 2, label: "그림 2.", text: "감쇠 곡선" },
      { id: "f3", number: 3, label: "그림 3.", text: "" },
    ]);
    expect(buildCaptionList(numbering, "table")).toEqual([{ id: "t1", number: 1, label: "표 1.", text: "측정 조건" }]);
    expect(buildCaptionList(numbering, "equation").map((e) => e.label)).toEqual(["식 (1)"]);
  });

  it("캡션이 없으면 빈 목차", () => {
    expect(buildCaptionList(computeNumbering(doc(p("본문"), captionList("figure"))), "figure")).toEqual([]);
  });

  it("그림을 지우면 목차도 줄고 번호가 당겨진다", () => {
    const d = sample();
    const after = doc(...(d.content ?? []).filter((n) => n.attrs?.id !== "f1"));
    expect(buildCaptionList(computeNumbering(after), "figure").map(captionListLine)).toEqual(["그림 1. 감쇠 곡선", "그림 2."]);
  });

  it("제목과 한 줄 표시", () => {
    expect(captionListTitle("figure")).toBe("그림 목차");
    expect(captionListTitle("table")).toBe("표 목차");
    expect(captionListLine({ id: "x", number: 1, label: "표 1.", text: "조건" })).toBe("표 1. 조건");
  });

  it("captionList 노드는 kind만 저장한다 (항목은 저장하지 않는다)", () => {
    const editor = headlessEditor(doc(img(), cap("figure", "f1", "장치"), p()));
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(editor.commands.insertCaptionList("figure")).toBe(true);
    const node = (editor.getJSON().content ?? []).find((n) => n.type === "captionList");
    expect(node).toEqual({ type: "captionList", attrs: { kind: "figure" } });
  });
});

describe("내보내기용 번호 굳히기 (materializeNumbering)", () => {
  it("캡션 머리·참조·목차를 글자로 바꾼 사본을 만들고 원본은 그대로 둔다", () => {
    const d = sample();
    const before = JSON.stringify(d);
    const out = materializeNumbering(d);
    expect(JSON.stringify(d)).toBe(before);
    const content = out.content ?? [];
    const texts = content.map((n) => (n.content ?? []).map((c) => c.text ?? "").join(""));

    // 그림 목차: 제목 + 3줄, 표 목차: 제목 + 1줄
    expect(texts.slice(0, 6)).toEqual(["그림 목차", "그림 1. 실험 장치", "그림 2. 감쇠 곡선", "그림 3.", "표 목차", "표 1. 측정 조건"]);
    expect(content[0].content?.[0].marks).toEqual([{ type: "bold" }]);
    expect(content.some((n) => n.type === "captionList")).toBe(false);

    const captions = content.filter((n) => n.type === "caption");
    expect(captions.map((n) => (n.content ?? []).map((c) => c.text).join(""))).toEqual([
      "그림 1. 실험 장치",
      "표 1. 측정 조건",
      "그림 2.   감쇠 곡선  ",
      "그림 3. ",
    ]);
    expect(captions[0].attrs).toEqual({ kind: "figure", id: "f1" });

    // 참조는 글자로, 깨진 참조는 깨진 참조 문구로
    expect(texts[texts.length - 1]).toBe("그림 2와 참조 오류");
    expect(JSON.stringify(out)).not.toContain("crossRef");
    // 블록 수식은 그대로 둔다
    expect(content.find((n) => n.type === "mathBlock")).toEqual(mathBlock("e1", "F=ma"));
    expect(docContentSchema.safeParse(out).success).toBe(true);
  });

  it("빈 목차에는 안내 문구가 들어간다", () => {
    const out = materializeNumbering(doc(captionList("table")));
    expect(out.content?.map((n) => n.content?.[0].text)).toEqual(["표 목차", "아직 항목이 없습니다."]);
  });

  it("참조에 걸린 서식(굵게 등)은 글자에도 남는다", () => {
    const bold = { ...ref("f"), marks: [{ type: "bold" }] };
    const out = materializeNumbering(doc(img(), cap("figure", "f"), p(bold)));
    expect(out.content?.[2].content?.[0]).toEqual({ type: "text", text: "그림 1", marks: [{ type: "bold" }] });
  });
});
