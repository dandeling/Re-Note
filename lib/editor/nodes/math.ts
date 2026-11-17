import { InputRule, mergeAttributes, Node, type Editor } from "@tiptap/core";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { newNodeId } from "./ids";

export type InsertMathOptions = {
  /** 넣은 수식을 선택 상태로 둔다 (바로 편집할 때) */
  select?: boolean;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathInline: {
      /** 커서 자리에 인라인 수식을 넣는다. */
      insertMathInline: (latex?: string, options?: InsertMathOptions) => ReturnType;
    };
    mathBlock: {
      /** 블록 수식을 넣는다. 번호는 문서 순서로 자동 부여된다. */
      insertMathBlock: (latex?: string, options?: InsertMathOptions) => ReturnType;
    };
  }
}

/** `$...$`: 닫는 `$`를 입력하면 인라인 수식이 된다. 내용의 앞뒤가 공백이면(금액 표기 등) 바꾸지 않는다. */
export const MATH_INLINE_INPUT = /(?:^|[^$])(\$([^\s$](?:[^$\n]*[^\s$])?)\$)$/;
/** `$$...$$`: 문단 전체가 이 모양이면 블록 수식이 된다. */
export const MATH_BLOCK_INPUT = /^\$\$([^$]+)\$\$$/;
/** `$$` 뒤에 공백: 빈 블록 수식을 만들고 바로 편집한다. */
export const MATH_BLOCK_EMPTY_INPUT = /^\$\$\s$/;

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-latex") ?? el.textContent ?? "",
        renderHTML: (attrs) => ({ "data-latex": attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-type": "math-inline", class: "doc-math-inline" }, HTMLAttributes), node.attrs.latex];
  },

  renderText({ node }) {
    return `$${node.attrs.latex}$`;
  },

  addCommands() {
    return {
      insertMathInline:
        (latex = "", options = {}) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.replaceSelectionWith(this.type.create({ latex }));
            const pos = tr.selection.from - 1;
            if (options.select && pos >= 0 && tr.doc.nodeAt(pos)?.type === this.type) {
              tr.setSelection(NodeSelection.create(tr.doc, pos));
            }
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: MATH_INLINE_INPUT,
        handler: ({ state, range, match }) => {
          const latex = match[2];
          if (!latex) return null;
          const from = range.from + match[0].indexOf(match[1]);
          state.tr.replaceWith(from, range.to, this.type.create({ latex }));
        },
      }),
    ];
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-latex") ?? el.textContent ?? "",
        renderHTML: (attrs) => ({ "data-latex": attrs.latex }),
      },
      id: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-id") ?? "",
        renderHTML: (attrs) => ({ "data-id": attrs.id }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "math-block", class: "doc-math-block" }, HTMLAttributes), node.attrs.latex];
  },

  renderText({ node }) {
    return `$$${node.attrs.latex}$$`;
  },

  addCommands() {
    return {
      insertMathBlock:
        (latex = "", options = {}) =>
        ({ tr, state, dispatch }) => {
          if (dispatch) {
            const id = newNodeId();
            tr.replaceSelectionWith(this.type.create({ latex, id }));
            let at = -1;
            tr.doc.descendants((node, pos) => {
              if (node.type === this.type && node.attrs.id === id) at = pos;
              return at < 0 && !node.isTextblock;
            });
            const node = at >= 0 ? tr.doc.nodeAt(at) : null;
            if (node && options.select) {
              tr.setSelection(NodeSelection.create(tr.doc, at));
            } else if (node) {
              // 수식 다음 줄로 커서를 옮긴다 (이어서 넣어도 방금 넣은 수식을 덮어쓰지 않게).
              const after = at + node.nodeSize;
              const $after = tr.doc.resolve(after);
              const paragraph = state.schema.nodes.paragraph;
              if (!$after.nodeAfter && $after.parent.canReplaceWith($after.index(), $after.index(), paragraph)) {
                tr.insert(after, paragraph.create());
              }
              tr.setSelection(Selection.near(tr.doc.resolve(after), 1));
            }
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },

  addInputRules() {
    const replaceParagraph = (latex: string, select: boolean) =>
      (({ state, range }) => {
        const { tr } = state;
        const $from = state.doc.resolve(range.from);
        // 문단 전체가 `$$...$$`일 때만 블록 수식으로 바꾼다.
        if ($from.parent.type.name !== "paragraph" || $from.parentOffset !== 0 || range.to !== $from.end()) return null;
        const start = $from.before();
        const node = this.type.create({ latex, id: newNodeId() });
        if (!$from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), this.type)) return null;
        tr.replaceWith(start, $from.after(), node);
        const after = start + node.nodeSize;
        if (select) {
          tr.setSelection(NodeSelection.create(tr.doc, start));
          return;
        }
        // 수식 다음 줄에서 계속 쓸 수 있게 한다.
        const next = tr.doc.resolve(after).nodeAfter;
        if (!next) tr.insert(after, state.schema.nodes.paragraph.create());
        if (!next || next.isTextblock) tr.setSelection(TextSelection.create(tr.doc, after + 1));
        else tr.setSelection(Selection.near(tr.doc.resolve(after), 1));
      }) satisfies InputRule["handler"];

    return [
      new InputRule({ find: MATH_BLOCK_INPUT, handler: (props) => replaceParagraph(props.match[1].trim(), false)(props) }),
      new InputRule({ find: MATH_BLOCK_EMPTY_INPUT, handler: (props) => replaceParagraph("", true)(props) }),
    ];
  },
});

/**
 * LaTeX 문자열을 받아 수식을 넣는다 (AI 제안 삽입 등 에디터 밖의 기능이 쓰는 진입점).
 * `display: true`면 번호가 붙는 블록 수식, 아니면 인라인 수식.
 */
export function insertLatex(editor: Editor, latex: string, options: { display?: boolean } = {}): boolean {
  const value = latex.trim();
  if (!value) return false;
  const inserted = options.display ? editor.commands.insertMathBlock(value) : editor.commands.insertMathInline(value);
  // 화면이 없는(서버·테스트) 에디터에서는 초점을 줄 수 없으므로 삽입 결과와 따로 처리한다.
  if (inserted && isMounted(editor)) editor.commands.focus();
  return inserted;
}

function isMounted(editor: Editor): boolean {
  try {
    return editor.view.dom.isConnected;
  } catch {
    return false;
  }
}
