import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import {
  BROKEN_REF_LABEL,
  collectCrossRefTargets,
  computeNumbering,
  filterRefTargets,
  findBrokenCrossRefs,
  isKindQuery,
  parseRefTrigger,
  resolveCrossRef,
  resolveCrossRefs,
} from "@/lib/captions";
import type { DocContent } from "@/lib/editor/content";
import { cap, doc, headlessEditor, img, mathBlock, p, ref, table } from "../setup/editor";

const refLabels = (d: DocContent) => resolveCrossRefs(d).map((r) => r.label);

/** 그림 3개(+캡션)와, 각 그림을 가리키는 본문 참조 */
const threeFigures = () =>
  doc(
    img("1.png"), cap("figure", "a", "장치"),
    img("2.png"), cap("figure", "b", "과정"),
    img("3.png"), cap("figure", "c", "결과"),
    p(ref("a"), "과 ", ref("b"), ", 그리고 ", ref("c"), "를 보라."),
  );

describe("상호 참조 (순수 함수)", () => {
  it("참조는 대상의 현재 번호를 보여 준다", () => {
    expect(refLabels(threeFigures())).toEqual(["그림 1", "그림 2", "그림 3"]);
  });

  it("[완료 기준] 그림 3개 중 2번째를 삭제하면 캡션과 본문 참조 번호가 자동으로 바뀐다", () => {
    const before = threeFigures();
    // 2번째 그림과 그 캡션을 지운다.
    const after = doc(...(before.content ?? []).filter((_, i) => i !== 2 && i !== 3));
    const numbering = computeNumbering(after);
    expect(numbering.entries.map((e) => `${e.captionLabel} ${e.text}`)).toEqual(["그림 1. 장치", "그림 2. 결과"]);
    const refs = resolveCrossRefs(after, numbering);
    expect(refs.map((r) => r.label)).toEqual(["그림 1", BROKEN_REF_LABEL, "그림 2"]);
    expect(refs.map((r) => r.broken)).toEqual([false, true, false]);
    expect(findBrokenCrossRefs(after).map((r) => r.targetId)).toEqual(["b"]);
  });

  it("앞에 그림을 끼워 넣으면 참조 번호도 밀린다", () => {
    const d = threeFigures();
    const inserted = doc(img("0.png"), cap("figure", "z", "새 그림"), ...(d.content ?? []));
    expect(refLabels(inserted)).toEqual(["그림 2", "그림 3", "그림 4"]);
  });

  it("표와 수식도 참조할 수 있다 (수식은 수식 id와 캡션 id 모두)", () => {
    const d = doc(
      cap("table", "t", "조건"), table(),
      mathBlock("e"), cap("equation", "ec", "운동 방정식"),
      p(ref("t"), ref("e"), ref("ec")),
    );
    expect(refLabels(d)).toEqual(["표 1", "식 (1)", "식 (1)"]);
  });

  it("대상 id가 비었거나 없는 참조는 깨진 참조", () => {
    const numbering = computeNumbering(threeFigures());
    expect(resolveCrossRef(numbering, "")).toMatchObject({ broken: true, label: "참조 오류", entry: null });
    expect(resolveCrossRef(numbering, "nope", "??")).toMatchObject({ broken: true, label: "??" });
    expect(resolveCrossRef(numbering, "c")).toMatchObject({ broken: false, label: "그림 3" });
  });

  it("캡션 안에 있는 참조도 모은다", () => {
    const d = doc(img(), { type: "caption", attrs: { kind: "figure", id: "a" }, content: [ref("a")] });
    expect(collectCrossRefTargets(d)).toEqual(["a"]);
  });
});

describe("@ 입력 찾기 (parseRefTrigger)", () => {
  it("`@그림`을 찾는다", () => {
    expect(parseRefTrigger("결과는 @그림")).toEqual({ query: "그림", start: 4 });
    expect(parseRefTrigger("@")).toEqual({ query: "", start: 0 });
    expect(parseRefTrigger("(@표1")).toEqual({ query: "표1", start: 1 });
  });

  it("이메일 주소나 끝난 입력은 무시한다", () => {
    expect(parseRefTrigger("user@example")).toBeNull();
    expect(parseRefTrigger("@그림 은")).toBeNull();
    expect(parseRefTrigger("글자만")).toBeNull();
    expect(parseRefTrigger(`@${"가".repeat(31)}`)).toBeNull();
  });

  it("가장 가까운 @만 본다", () => {
    expect(parseRefTrigger("@그림 그리고 @식")).toEqual({ query: "식", start: 8 });
  });
});

describe("참조 대상 고르기 (filterRefTargets)", () => {
  const entries = computeNumbering(
    doc(
      img(), cap("figure", "f1", "실험 장치"),
      img(), cap("figure", "f2", "감쇠 곡선"),
      cap("table", "t1", "측정 조건"), table(),
      mathBlock("e1", "F=ma"),
      cap("figure", "", "id 없는 캡션"),
    ),
  ).entries;
  const ids = (query: string) => filterRefTargets(entries, query).map((e) => e.id);

  it("빈 입력이면 참조할 수 있는 전부 (id 없는 항목 제외)", () => {
    expect(ids("")).toEqual(["f1", "f2", "t1", "e1"]);
  });
  it("종류 이름으로 거른다", () => {
    expect(ids("그림")).toEqual(["f1", "f2"]);
    expect(ids("그")).toEqual(["f1", "f2"]);
    expect(ids("표")).toEqual(["t1"]);
    expect(ids("식")).toEqual(["e1"]);
  });
  it("번호까지 쓰면 그 항목만", () => {
    expect(ids("그림2")).toEqual(["f2"]);
    expect(ids("그림 2")).toEqual(["f2"]);
    expect(ids("식(1)")).toEqual(["e1"]);
  });
  it("캡션 내용으로도 찾는다", () => {
    expect(ids("감쇠")).toEqual(["f2"]);
    expect(ids("없는말")).toEqual([]);
  });
  it("종류 이름으로 시작하는 입력인지 구분한다", () => {
    expect(isKindQuery("")).toBe(true);
    expect(isKindQuery("그림")).toBe(true);
    expect(isKindQuery("그림3")).toBe(true);
    expect(isKindQuery("표")).toBe(true);
    expect(isKindQuery("홍길동")).toBe(false);
  });
});

describe("상호 참조 (에디터)", () => {
  const numbering = (editor: Editor) => computeNumbering(editor.getJSON() as DocContent);
  const labels = (editor: Editor) => resolveCrossRefs(editor.getJSON() as DocContent).map((r) => r.label);

  it("[완료 기준] 에디터에서 2번째 그림을 지우면 캡션이 사라지고 참조 번호가 따라간다", () => {
    const editor = headlessEditor(threeFigures());
    expect(labels(editor)).toEqual(["그림 1", "그림 2", "그림 3"]);
    const pos = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    editor.commands.deleteSelection();
    expect(numbering(editor).entries.map((e) => `${e.captionLabel} ${e.text}`)).toEqual(["그림 1. 장치", "그림 2. 결과"]);
    expect(labels(editor)).toEqual(["그림 1", "참조 오류", "그림 2"]);
    // 되돌리면 번호도 원래대로
    editor.commands.undo();
    expect(labels(editor)).toEqual(["그림 1", "그림 2", "그림 3"]);
  });

  it("insertCrossRef는 targetId만 저장한다 (번호는 저장하지 않는다)", () => {
    const editor = headlessEditor(doc(img(), cap("figure", "a", "장치"), p("본문 ")));
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(editor.commands.insertCrossRef("a")).toBe(true);
    const paragraph = editor.getJSON().content?.[2];
    expect(paragraph?.content?.[1]).toEqual({ type: "crossRef", attrs: { targetId: "a" } });
    expect(JSON.stringify(editor.getJSON())).not.toContain("그림 1");
    expect(editor.commands.insertCrossRef("")).toBe(false);
  });
});
