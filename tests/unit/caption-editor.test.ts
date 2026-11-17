import type { Editor } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { computeNumbering } from "@/lib/captions";
import type { DocContent } from "@/lib/editor/content";
import { documentExtensions } from "@/lib/editor/extensions";
import { captionJSON, findCaptionTarget } from "@/lib/editor/nodes/caption";
import { newNodeId } from "@/lib/editor/nodes/ids";
import { cap, doc, headlessEditor, img, mathBlock, p, shape, table } from "../setup/editor";

/** n번째(0부터) 최상위 노드의 시작 위치 */
function posOf(editor: Editor, index: number) {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
  return pos;
}
function selectNode(editor: Editor, index: number) {
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, posOf(editor, index))));
}
function numbering(editor: Editor) {
  return computeNumbering(editor.getJSON() as DocContent);
}

describe("문서 스키마", () => {
  it("계약대로 caption / crossRef / mathInline / mathBlock 노드가 있다", () => {
    const schema = getSchema(documentExtensions());
    expect(schema.nodes.caption.spec).toMatchObject({ group: "block", content: "inline*" });
    expect(Object.keys(schema.nodes.caption.spec.attrs ?? {})).toEqual(["kind", "id"]);
    expect(schema.nodes.crossRef.spec).toMatchObject({ inline: true, atom: true });
    expect(Object.keys(schema.nodes.crossRef.spec.attrs ?? {})).toEqual(["targetId"]);
    expect(schema.nodes.mathInline.spec).toMatchObject({ inline: true, atom: true });
    expect(Object.keys(schema.nodes.mathInline.spec.attrs ?? {})).toEqual(["latex"]);
    expect(schema.nodes.mathBlock.spec).toMatchObject({ group: "block", atom: true });
    expect(Object.keys(schema.nodes.mathBlock.spec.attrs ?? {})).toEqual(["latex", "id"]);
  });

  it("저장된 JSON이 그대로 왕복한다", () => {
    const content = doc(img(), cap("figure", "f1", "장치"), p("본문"));
    const json = headlessEditor(content).getJSON();
    expect(json.content?.[1]).toEqual({ type: "caption", attrs: { kind: "figure", id: "f1" }, content: [{ type: "text", text: "장치" }] });
  });
});

describe("캡션 삽입 (insertCaption)", () => {
  it("그림을 선택하고 실행하면 그림 아래에 캡션이 생기고 커서가 그 안에 있다", () => {
    const editor = headlessEditor(doc(img(), p("본문")));
    selectNode(editor, 0);
    expect(editor.commands.insertCaption()).toBe(true);
    expect(shape(editor).map((s) => s.split(":").slice(0, 2).join(":"))).toEqual(["image", "caption:figure", "paragraph"]);
    expect(editor.state.selection.$from.parent.type.name).toBe("caption");
    expect(editor.state.doc.child(1).attrs.id).toMatch(/^[a-z0-9]{12}$/);
  });

  it("표 안에 커서가 있으면 표 위에 캡션이 생긴다", () => {
    const editor = headlessEditor(doc(p("앞"), table()));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, posOf(editor, 1) + 4)));
    expect(findCaptionTarget(editor.state)?.kind).toBe("table");
    editor.commands.insertCaption({ text: "측정 조건" });
    expect(shape(editor).map((s) => s.split(":").slice(0, 2).join(":"))).toEqual(["paragraph", "caption:table", "table", "paragraph"]);
    expect(numbering(editor).entries[0]).toMatchObject({ captionLabel: "표 1.", text: "측정 조건" });
  });

  it("블록 수식에는 수식 캡션이 아래에 생긴다", () => {
    const editor = headlessEditor(doc(mathBlock("e1"), p()));
    selectNode(editor, 0);
    editor.commands.insertCaption();
    expect(shape(editor)[1]).toMatch(/^caption:equation:/);
  });

  it("위치 규칙을 인자로 바꿀 수 있다 (그림 캡션을 위로)", () => {
    const editor = headlessEditor(doc(p("앞"), img()));
    selectNode(editor, 1);
    editor.commands.insertCaption({ positions: { figure: "above" } });
    expect(shape(editor).map((s) => s.split(":")[0])).toEqual(["paragraph", "caption", "image", "paragraph"]);
  });

  it("확장 옵션(서식 템플릿)으로 위치 규칙을 바꿀 수 있다", () => {
    const editor = headlessEditor(doc(table(), p()), { captionPositions: { table: "below" } });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));
    editor.commands.insertCaption();
    expect(shape(editor).map((s) => s.split(":")[0])).toEqual(["table", "caption", "paragraph"]);
  });

  it("이미 캡션이 있으면 새로 만들지 않고 그 캡션으로 간다", () => {
    const editor = headlessEditor(doc(img(), cap("figure", "f1", "장치"), p()));
    selectNode(editor, 0);
    expect(editor.commands.insertCaption()).toBe(true);
    expect(shape(editor)).toEqual(["image", "caption:figure:f1", "paragraph"]);
    expect(editor.state.selection.$from.parent.attrs.id).toBe("f1");
  });

  it("앞 그림의 캡션을 뒤 그림의 캡션으로 착각하지 않는다", () => {
    const editor = headlessEditor(doc(img(), cap("figure", "f1"), img(), p()));
    selectNode(editor, 2);
    editor.commands.insertCaption();
    expect(shape(editor).map((s) => s.split(":")[0])).toEqual(["image", "caption", "image", "caption", "paragraph"]);
    expect(numbering(editor).entries.map((e) => e.number)).toEqual([1, 2]);
  });

  it("대상이 선택되지 않았으면 아무 일도 하지 않는다", () => {
    const editor = headlessEditor(doc(p("본문"), img()));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    expect(editor.can().insertCaption()).toBe(false);
    expect(editor.commands.insertCaption()).toBe(false);
    expect(shape(editor)).toEqual(["paragraph", "image", "paragraph"]);
  });

  it("중간 그림에 캡션을 넣으면 뒤 캡션 번호가 밀린다", () => {
    const editor = headlessEditor(doc(img(), cap("figure", "a"), img(), img(), cap("figure", "c"), p()));
    expect(numbering(editor).byId.get("c")?.number).toBe(2);
    selectNode(editor, 2);
    editor.commands.insertCaption();
    expect(numbering(editor).byId.get("c")?.number).toBe(3);
  });
});

describe("대상을 지우면 캡션도 함께 지워진다", () => {
  it("그림 3개 중 2번째를 지우면 그 캡션이 사라지고 3번째가 그림 2가 된다", () => {
    const editor = headlessEditor(
      doc(img("1.png"), cap("figure", "a"), img("2.png"), cap("figure", "b"), img("3.png"), cap("figure", "c"), p()),
    );
    selectNode(editor, 2);
    editor.commands.deleteSelection();
    expect(shape(editor)).toEqual(["image", "caption:figure:a", "image", "caption:figure:c", "paragraph"]);
    expect(numbering(editor).byId.get("c")?.captionLabel).toBe("그림 2.");
  });

  it("표를 지우면 위에 있던 표 캡션도 지워진다", () => {
    const editor = headlessEditor(doc(cap("table", "t1", "조건"), table(), p("끝")));
    editor.view.dispatch(editor.state.tr.delete(posOf(editor, 1), posOf(editor, 2)));
    expect(shape(editor)).toEqual(["paragraph"]);
  });

  it("캡션만 지우는 것은 대상에 영향을 주지 않는다", () => {
    const editor = headlessEditor(doc(img(), cap("figure", "a"), p()));
    editor.view.dispatch(editor.state.tr.delete(posOf(editor, 1), posOf(editor, 2)));
    expect(shape(editor)).toEqual(["image", "paragraph"]);
  });

  it("대상이 없는 캡션은 다른 것을 지워도 남는다", () => {
    const editor = headlessEditor(doc(p("지울 문단"), cap("figure", "solo", "혼자"), p()));
    editor.view.dispatch(editor.state.tr.delete(0, posOf(editor, 1)));
    expect(shape(editor)).toEqual(["caption:figure:solo", "paragraph"]);
  });

  it("그림을 다른 그림으로 바꾸면 캡션은 남는다", () => {
    const editor = headlessEditor(doc(img("old.png"), cap("figure", "a"), p()));
    const replacement = editor.schema.nodes.image.create({ src: "new.png" });
    editor.view.dispatch(editor.state.tr.replaceWith(0, 1, replacement));
    expect(shape(editor)).toEqual(["image", "caption:figure:a", "paragraph"]);
  });

  it("실행 취소하면 그림과 캡션이 함께 돌아온다", () => {
    const editor = headlessEditor(doc(img(), cap("figure", "a", "장치"), p()));
    selectNode(editor, 0);
    editor.commands.deleteSelection();
    expect(shape(editor)).toEqual(["paragraph"]);
    editor.commands.undo();
    expect(shape(editor)).toEqual(["image", "caption:figure:a", "paragraph"]);
  });
});

describe("id 관리", () => {
  it("같은 id가 둘이 되면 뒤쪽에 새 id를 준다 (복사·붙여넣기)", () => {
    const editor = headlessEditor(doc(img(), cap("figure", "a", "원본"), p()));
    const copy = editor.schema.nodeFromJSON(cap("figure", "a", "사본"));
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, copy));
    const ids = (editor.getJSON().content ?? []).filter((n) => n.type === "caption").map((n) => n.attrs?.id);
    expect(ids[0]).toBe("a");
    expect(ids[1]).not.toBe("a");
    expect(ids[1]).toMatch(/^[a-z0-9]{12}$/);
  });

  it("id가 빈 캡션·블록 수식에는 id를 채운다", () => {
    const editor = headlessEditor(doc(p()));
    editor.view.dispatch(
      editor.state.tr.insert(0, [editor.schema.nodeFromJSON(mathBlock("", "x")), editor.schema.nodeFromJSON(cap("table", ""))]),
    );
    const [math, caption] = editor.getJSON().content ?? [];
    expect(math.attrs?.id).toMatch(/^[a-z0-9]{12}$/);
    expect(caption.attrs?.id).toMatch(/^[a-z0-9]{12}$/);
    expect(math.attrs?.id).not.toBe(caption.attrs?.id);
  });

  it("newNodeId는 겹치지 않는 12자 id를 만든다", () => {
    const ids = new Set(Array.from({ length: 500 }, newNodeId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{12}$/);
  });

  it("captionJSON은 다른 기능이 표·그래프와 함께 넣을 캡션을 만든다", () => {
    expect(captionJSON("table", "측정값")).toMatchObject({ type: "caption", attrs: { kind: "table" }, content: [{ type: "text", text: "측정값" }] });
    expect(captionJSON("figure").content).toBeUndefined();
  });
});
