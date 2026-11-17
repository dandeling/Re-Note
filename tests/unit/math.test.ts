import type { Editor } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import katex from "katex";
import { describe, expect, it } from "vitest";
import { computeNumbering, resolveCrossRef } from "@/lib/captions";
import type { DocContent } from "@/lib/editor/content";
import { documentExtensions } from "@/lib/editor/extensions";
import { insertLatex, MATH_BLOCK_INPUT, MATH_INLINE_INPUT } from "@/lib/editor/nodes/math";
import { insertSnippet, MATH_PALETTE } from "@/lib/math/palette";
import { messages } from "@/lib/messages";
import { cap, doc, headlessEditor, mathBlock, mathInline, p, ref } from "../setup/editor";

/**
 * 사용자가 글자를 하나씩 치는 것처럼 입력 규칙 플러그인을 거쳐 넣는다.
 * (단위 테스트에는 화면이 없으므로 플러그인의 handleTextInput을 직접 부른다.)
 */
function typeText(editor: Editor, value: string) {
  const plugins = editor.state.plugins.filter((plugin) => plugin.props.handleTextInput);
  for (const ch of value) {
    const { from, to } = editor.state.selection;
    const handled = plugins.some((plugin) =>
      plugin.props.handleTextInput?.call(plugin, editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)),
    );
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}

function emptyEditor(content: DocContent = doc(p())) {
  const editor = headlessEditor(content);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
  return editor;
}

const json = (editor: Editor) => editor.getJSON() as DocContent;
/** n번째 최상위 문단을 textAlign 등 기본 attrs 없이 */
const para = (editor: Editor, index: number) => ({ type: "paragraph", content: json(editor).content?.[index]?.content });

describe("입력 규칙 정규식", () => {
  it("$...$는 닫는 $에서 맞고, 앞뒤 공백·빈 내용은 맞지 않는다", () => {
    expect("값은 $x^2$".match(MATH_INLINE_INPUT)?.[2]).toBe("x^2");
    expect("$a+b$".match(MATH_INLINE_INPUT)?.[2]).toBe("a+b");
    expect("$x$".match(MATH_INLINE_INPUT)?.[2]).toBe("x");
    expect("가격 $ 5 $".match(MATH_INLINE_INPUT)).toBeNull();
    expect("$$".match(MATH_INLINE_INPUT)).toBeNull();
    expect("$$x$".match(MATH_INLINE_INPUT)).toBeNull();
  });

  it("$$...$$는 문단 전체일 때만 블록 수식", () => {
    expect("$$E=mc^2$$".match(MATH_BLOCK_INPUT)?.[1]).toBe("E=mc^2");
    expect("앞 $$x$$".match(MATH_BLOCK_INPUT)).toBeNull();
  });
});

describe("입력하면 바로 수식 노드가 된다", () => {
  it("$x^2$ → 인라인 수식, 앞 글자는 남는다", () => {
    const editor = emptyEditor();
    typeText(editor, "넓이 $x^2$");
    expect(para(editor, 0)).toEqual(p("넓이 ", mathInline("x^2")));
    // 이어서 쓰면 수식 뒤에 글자가 붙는다.
    typeText(editor, " 이다");
    expect(para(editor, 0)).toEqual(p("넓이 ", mathInline("x^2"), " 이다"));
  });

  it("금액 표기($5와 $10)는 수식으로 바꾸지 않는다", () => {
    const editor = emptyEditor();
    typeText(editor, "$5와 $10");
    expect(para(editor, 0)).toEqual(p("$5와 $10"));
  });

  it("$$E=mc^2$$ → 번호가 붙는 블록 수식, 다음 줄에서 계속 쓴다", () => {
    const editor = emptyEditor();
    typeText(editor, "$$E=mc^2$$");
    const content = json(editor).content ?? [];
    expect(content[0].type).toBe("mathBlock");
    expect(content[0].attrs?.latex).toBe("E=mc^2");
    expect(content[0].attrs?.id).toMatch(/^[a-z0-9]{12}$/);
    typeText(editor, "다음");
    expect(content.length).toBe(2);
    expect(para(editor, 1)).toEqual(p("다음"));
    expect(computeNumbering(json(editor)).byId.get(String(content[0].attrs?.id))?.captionLabel).toBe("식 (1)");
  });

  it("$$ 뒤에 공백을 치면 빈 블록 수식이 선택된 채로 생긴다(바로 LaTeX 입력)", () => {
    const editor = emptyEditor();
    typeText(editor, "$$ ");
    expect(json(editor).content?.[0]).toMatchObject({ type: "mathBlock", attrs: { latex: "" } });
    expect(editor.state.selection.from).toBe(0);
    expect(editor.state.selection.to).toBe(editor.state.doc.child(0).nodeSize);
  });

  it("문단 중간의 $$...$$는 블록으로 바꾸지 않는다", () => {
    const editor = emptyEditor();
    typeText(editor, "앞 $$x$$");
    expect(json(editor).content?.some((n) => n.type === "mathBlock")).toBe(false);
  });
});

describe("LaTeX 문자열로 수식 넣기 (insertLatex)", () => {
  it("인라인/블록을 고를 수 있고, 빈 문자열은 넣지 않는다", () => {
    const editor = emptyEditor(doc(p("가"), p()));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    expect(insertLatex(editor, "  \\alpha  ")).toBe(true);
    expect(para(editor, 0)).toEqual(p("가", mathInline("\\alpha")));

    expect(insertLatex(editor, "   ", { display: true })).toBe(false);
    expect(insertLatex(editor, "\\int_0^1 x\\,dx", { display: true })).toBe(true);
    const blocks = (json(editor).content ?? []).filter((n) => n.type === "mathBlock");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.latex).toBe("\\int_0^1 x\\,dx");
  });

  it("블록 수식 번호는 문서 순서로 다시 매겨지고, 참조도 따라간다", () => {
    const editor = headlessEditor(doc(mathBlock("e1", "a"), mathBlock("e2", "b"), p(ref("e2")), p()));
    expect(resolveCrossRef(computeNumbering(json(editor)), "e2").label).toBe("식 (2)");

    // 맨 앞에 수식을 하나 더 넣으면 e2는 식 (3)으로 밀린다.
    editor.view.dispatch(editor.state.tr.insert(0, editor.schema.nodes.mathBlock.create({ latex: "c", id: "e0" })));
    expect(resolveCrossRef(computeNumbering(json(editor)), "e2").label).toBe("식 (3)");

    // e0, e1을 지우면 e2가 식 (1)로 당겨지고, e1 참조는 깨진다.
    const end = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
    editor.view.dispatch(editor.state.tr.delete(0, end));
    const numbering = computeNumbering(json(editor));
    expect(resolveCrossRef(numbering, "e2").label).toBe("식 (1)");
    expect(resolveCrossRef(numbering, "e1")).toMatchObject({ broken: true, label: messages.captions.brokenRef });
  });

  it("insertMathBlock은 매번 새 id를 준다", () => {
    const editor = emptyEditor();
    editor.commands.insertMathBlock("x");
    editor.commands.insertMathBlock("y");
    const ids = (json(editor).content ?? []).filter((n) => n.type === "mathBlock").map((n) => n.attrs?.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("저장·내보내기 표현", () => {
  it("JSON에는 latex(와 블록의 id)만 저장되고 그대로 왕복한다", () => {
    const content = doc(p("식 ", mathInline("x_i")), mathBlock("e1", "\\frac{a}{b}"), cap("equation", "c1", "운동 방정식"));
    const out = headlessEditor(content).getJSON().content ?? [];
    expect(out[0].content?.[1]).toEqual(mathInline("x_i"));
    expect(out.slice(1)).toEqual(content.content?.slice(1));
  });

  it("서버용 renderHTML은 KaTeX 없이 LaTeX 원문을 data-latex와 함께 낸다", () => {
    const schema = getSchema(documentExtensions());
    const inline = schema.nodes.mathInline.create({ latex: "x<1" });
    const block = schema.nodes.mathBlock.create({ latex: "a&b", id: "e1" });
    expect(schema.nodes.mathInline.spec.toDOM?.(inline)).toEqual([
      "span",
      { "data-type": "math-inline", class: "doc-math-inline", "data-latex": "x<1" },
      "x<1",
    ]);
    expect(schema.nodes.mathBlock.spec.toDOM?.(block)).toEqual([
      "div",
      { "data-type": "math-block", class: "doc-math-block", "data-latex": "a&b", "data-id": "e1" },
      "a&b",
    ]);
  });

  it("HTML에서 읽을 때는 data-latex(없으면 글자)를 쓴다", () => {
    const schema = getSchema(documentExtensions());
    const el = (attrs: Record<string, string>, textContent = "") =>
      ({ getAttribute: (name: string) => attrs[name] ?? null, textContent }) as unknown as HTMLElement;
    const parseLatex = schema.nodes.mathInline.spec.parseDOM?.[0];
    expect(parseLatex?.tag).toBe('span[data-type="math-inline"]');
    expect(schema.nodes.mathBlock.spec.parseDOM?.[0]?.tag).toBe('div[data-type="math-block"]');
    const attrs = (node: "mathInline" | "mathBlock", dom: HTMLElement) =>
      schema.nodes[node].spec.parseDOM?.[0]?.getAttrs?.(dom as never);
    expect(attrs("mathInline", el({ "data-latex": "\\beta" }, "β"))).toMatchObject({ latex: "\\beta" });
    expect(attrs("mathInline", el({}, "x+1"))).toMatchObject({ latex: "x+1" });
    expect(attrs("mathBlock", el({ "data-latex": "y=ax", "data-id": "e9" }))).toMatchObject({ latex: "y=ax", id: "e9" });
  });

  it("글자로 꺼내면 $...$ / $$...$$", () => {
    const editor = headlessEditor(doc(p("a ", mathInline("x")), mathBlock("e1", "y")));
    expect(editor.getText()).toContain("$x$");
    expect(editor.getText()).toContain("$$y$$");
  });
});

describe("수식 팔레트", () => {
  it("분수·적분·행렬·그리스 문자 묶음이 있다", () => {
    const keys = MATH_PALETTE.map((g) => g.key);
    expect(keys).toEqual(expect.arrayContaining(["structure", "calculus", "matrix", "greek"]));
    const all = MATH_PALETTE.flatMap((g) => g.items.map((i) => i.latex));
    expect(all).toContain("\\frac{}{}");
    expect(all.some((l) => l.startsWith("\\int"))).toBe(true);
    expect(all.some((l) => l.includes("pmatrix"))).toBe(true);
    expect(all).toContain("\\alpha ");
  });

  it("모든 항목은 KaTeX가 오류 없이 그리고, 이름 있는 항목은 문구가 있다", () => {
    for (const group of MATH_PALETTE) {
      expect(messages.math.groups[group.key]).toBeTruthy();
      for (const item of group.items) {
        expect(() => katex.renderToString(item.preview ?? item.latex, { throwOnError: true })).not.toThrow();
        // 빈 칸이 있는 조각도 그 자체로 문법이 맞아야 한다.
        expect(() => katex.renderToString(item.latex, { throwOnError: true })).not.toThrow();
        if (item.name) expect(messages.math.items[item.name]).toBeTruthy();
        if (item.caret !== undefined) expect(item.caret).toBeLessThanOrEqual(item.latex.length);
      }
    }
  });

  it("insertSnippet: 커서 자리에 넣고 커서를 빈 칸 안에 둔다", () => {
    const frac = { latex: "\\frac{}{}", caret: 6 };
    expect(insertSnippet("x=", 2, 2, frac)).toEqual({ value: "x=\\frac{}{}", caret: 8 });
    // 선택 영역은 바뀐다.
    expect(insertSnippet("a+b", 0, 1, { latex: "\\alpha " })).toEqual({ value: "\\alpha +b", caret: 7 });
    // 범위를 벗어난 위치는 끝으로 맞춘다.
    expect(insertSnippet("ab", 10, 99, { latex: "c" })).toEqual({ value: "abc", caret: 3 });
    expect(insertSnippet("ab", 2, 1, { latex: "c" })).toEqual({ value: "abc", caret: 3 });
  });
});
