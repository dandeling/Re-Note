import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { captureSelection, insertSuggestedLatex, insertSuggestedText, textToContent } from "@/lib/editor/ai-insert";
import { doc, headlessEditor, p } from "../setup/editor";

type Json = { type?: string; text?: string; content?: Json[] };
const texts = (editor: Editor) =>
  ((editor.getJSON() as Json).content ?? []).map((n) => (n.content ?? []).map((c) => c.text ?? `[${c.type}]`).join(""));
const select = (editor: Editor, from: number, to = from) =>
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));

/** n번째 최상위 문단의 내용 전체를 선택한다 (문단 노드 시작 위치 + 1 ~ 끝 - 1). */
function selectParagraph(editor: Editor, index: number) {
  let pos = 0;
  editor.state.doc.forEach((node, offset, i) => {
    if (i === index) pos = offset;
  });
  const node = editor.state.doc.child(index);
  select(editor, pos + 1, pos + 1 + node.content.size);
}

describe("챗봇 제안 삽입 (SPEC 7.4)", () => {
  it("질문 당시 선택한 문단이 그대로면 그 부분을 바꾼다", () => {
    const editor = headlessEditor(doc(p("첫 문단"), p("다듬을 문단"), p("끝 문단")));
    selectParagraph(editor, 1);
    const captured = captureSelection(editor);
    expect(captured?.text).toBe("다듬을 문단");
    expect(insertSuggestedText(editor, "다듬은 문단", "replace_selection", captured)).toBe(true);
    expect(texts(editor)).toEqual(["첫 문단", "다듬은 문단", "끝 문단"]);
  });

  it("여러 줄 제안은 문단 노드로 넣는다", () => {
    const editor = headlessEditor(doc(p("첫 문단"), p("다듬을 문단"), p("끝 문단")));
    selectParagraph(editor, 1);
    const captured = captureSelection(editor);
    insertSuggestedText(editor, "새 문단 하나\n\n새 문단 둘\r\n새 문단 셋", "replace_selection", captured);
    expect(texts(editor)).toEqual(["첫 문단", "새 문단 하나", "새 문단 둘", "새 문단 셋", "끝 문단"]);
  });

  it("선택이 바뀌었으면 지우지 않고 지금 커서 위치에 넣는다", () => {
    const editor = headlessEditor(doc(p("첫 문단"), p("다듬을 문단")));
    selectParagraph(editor, 1);
    const captured = captureSelection(editor);
    select(editor, 5); // "첫 문단" 끝으로 커서 이동
    insertSuggestedText(editor, "+추가", "replace_selection", captured);
    expect(texts(editor)).toEqual(["첫 문단+추가", "다듬을 문단"]);
  });

  it("선택된 글이 바뀌었으면(같은 범위라도) 바꾸지 않는다", () => {
    const editor = headlessEditor(doc(p("가나다라")));
    select(editor, 1, 3);
    const captured = captureSelection(editor);
    editor.view.dispatch(editor.state.tr.insertText("마바", 1, 3));
    select(editor, 1, 3);
    insertSuggestedText(editor, "X", "replace_selection", captured);
    expect(texts(editor)).toEqual(["마바X다라"]);
  });

  it("선택이 없으면(insert 모드 포함) 커서 위치에 넣고, 글자는 HTML로 해석하지 않는다", () => {
    const editor = headlessEditor(doc(p("문단")));
    select(editor, 3);
    expect(captureSelection(editor)).toBeUndefined();
    insertSuggestedText(editor, "<b>굵게</b>", "insert", undefined);
    expect(texts(editor)).toEqual(["문단<b>굵게</b>"]);
    expect(insertSuggestedText(editor, " \n ", "insert", undefined)).toBe(false);
    expect(textToContent("한 줄")).toEqual({ type: "text", text: "한 줄" });
  });

  it("수식 제안은 선택 영역을 지우지 않고 그 끝에 넣는다", () => {
    const editor = headlessEditor(doc(p("가나다")));
    select(editor, 1, 3);
    expect(insertSuggestedLatex(editor, "x^2", "inline")).toBe(true);
    expect(texts(editor)).toEqual(["가나[mathInline]다"]);
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"latex":"x^2"');
  });
});
