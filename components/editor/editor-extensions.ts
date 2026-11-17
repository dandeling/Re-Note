import { Extension, type Extensions } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Decoration } from "@tiptap/pm/view";
import katex from "katex";
import { captionListTitle, type CaptionListEntry } from "@/lib/captions/list";
import { isCaptionKind } from "@/lib/captions/types";
import { documentExtensions, type DocumentExtensionOptions } from "@/lib/editor/extensions";
import { CaptionList } from "@/lib/editor/nodes/caption";
import { CrossRef } from "@/lib/editor/nodes/cross-ref";
import { MathBlock, MathInline } from "@/lib/editor/nodes/math";
import { messages } from "@/lib/messages";
import { crossRefSuggestPlugin } from "./cross-ref-suggest";
import { numberingPlugin, readNumberSpec } from "./numbering-plugin";

/** 수식 편집 입력란의 id. 수식을 선택하고 Enter를 누르면 여기로 초점이 간다. */
export const MATH_INPUT_ID = "math-latex-input";

function renderMath(target: HTMLElement, latex: string, displayMode: boolean) {
  if (!latex.trim()) {
    target.textContent = messages.math.placeholder;
    target.classList.add("doc-math-empty");
    return;
  }
  target.classList.remove("doc-math-empty");
  // throwOnError: false → 문법 오류는 원문을 붉게 보여 준다. trust는 기본값(false) 그대로 둔다.
  katex.render(latex, target, { displayMode, throwOnError: false, output: "htmlAndMathml" });
}

const MathInlineView = MathInline.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "doc-math-inline";
      dom.dataset.type = "math-inline";
      let latex: string | null = null;
      const draw = (next: string) => {
        if (next === latex) return;
        latex = next;
        dom.dataset.latex = next;
        renderMath(dom, next, false);
      };
      draw(node.attrs.latex);
      return {
        dom,
        ignoreMutation: () => true,
        update: (updated) => {
          if (updated.type.name !== "mathInline") return false;
          draw(updated.attrs.latex);
          return true;
        },
      };
    };
  },
});

const MathBlockView = MathBlock.extend({
  addNodeView() {
    return ({ node, decorations }) => {
      const dom = document.createElement("div");
      dom.className = "doc-math-block";
      dom.dataset.type = "math-block";
      const body = document.createElement("div");
      body.className = "doc-math-body";
      const tag = document.createElement("span");
      tag.className = "doc-math-tag";
      dom.append(body, tag);
      let latex: string | null = null;
      const draw = (next: string, decos: readonly Decoration[]) => {
        if (next !== latex) {
          latex = next;
          dom.dataset.latex = next;
          renderMath(body, next, true);
        }
        const text = readNumberSpec(decos).tag ?? "";
        if (tag.textContent !== text) {
          tag.textContent = text;
          tag.setAttribute("aria-label", messages.math.equationNumber.replace("{tag}", text));
        }
      };
      draw(node.attrs.latex, decorations);
      return {
        dom,
        ignoreMutation: () => true,
        update: (updated, decos) => {
          if (updated.type.name !== "mathBlock") return false;
          dom.dataset.id = updated.attrs.id;
          draw(updated.attrs.latex, decos);
          return true;
        },
      };
    };
  },
});

const CrossRefView = CrossRef.extend({
  addNodeView() {
    return ({ node, decorations }) => {
      const dom = document.createElement("span");
      dom.className = "doc-cross-ref";
      dom.dataset.type = "cross-ref";
      dom.contentEditable = "false";
      const draw = (targetId: string, decos: readonly Decoration[]) => {
        const spec = readNumberSpec(decos);
        const broken = spec.broken ?? true;
        const label = spec.refLabel ?? messages.captions.brokenRef;
        dom.dataset.targetId = targetId;
        dom.dataset.broken = String(broken);
        dom.title = broken ? messages.captions.brokenRefTitle : messages.captions.refTitle.replace("{label}", label);
        if (dom.textContent !== label) dom.textContent = label;
      };
      draw(node.attrs.targetId, decorations);
      return {
        dom,
        ignoreMutation: () => true,
        update: (updated, decos) => {
          if (updated.type.name !== "crossRef") return false;
          draw(updated.attrs.targetId, decos);
          return true;
        },
      };
    };
  },
});

const CaptionListView = CaptionList.extend({
  addNodeView() {
    return ({ node, decorations }) => {
      const dom = document.createElement("div");
      dom.className = "doc-caption-list";
      dom.dataset.type = "caption-list";
      dom.contentEditable = "false";
      const title = document.createElement("p");
      title.className = "doc-caption-list-title";
      const list = document.createElement("ol");
      dom.append(title, list);
      let drawn = "";
      const draw = (kind: unknown, decos: readonly Decoration[]) => {
        const k = isCaptionKind(kind) ? kind : "figure";
        const json = readNumberSpec(decos).list ?? "[]";
        if (drawn === `${k}:${json}`) return;
        drawn = `${k}:${json}`;
        dom.dataset.kind = k;
        dom.setAttribute("aria-label", captionListTitle(k));
        title.textContent = captionListTitle(k);
        const entries = JSON.parse(json) as CaptionListEntry[];
        list.replaceChildren(
          ...(entries.length ? entries : [null]).map((entry) => {
            const li = document.createElement("li");
            if (!entry) {
              li.className = "doc-caption-list-empty";
              li.textContent = messages.captions.listEmpty;
              return li;
            }
            const label = document.createElement("span");
            label.className = "doc-caption-list-label";
            label.textContent = entry.label;
            li.append(label, ` ${entry.text}`);
            return li;
          }),
        );
      };
      draw(node.attrs.kind, decorations);
      return {
        dom,
        ignoreMutation: () => true,
        update: (updated, decos) => {
          if (updated.type.name !== "captionList") return false;
          draw(updated.attrs.kind, decos);
          return true;
        },
      };
    };
  },
});

/** 번호 계산·`@` 참조 고르기 등 화면 전용 동작 */
const ReportUi = Extension.create({
  name: "reportUi",
  addProseMirrorPlugins() {
    return [numberingPlugin(), crossRefSuggestPlugin()];
  },
  addKeyboardShortcuts() {
    return {
      // 수식을 선택한 채 Enter → LaTeX 입력란으로 이동
      Enter: () => {
        const { selection } = this.editor.state;
        if (!(selection instanceof NodeSelection)) return false;
        if (!["mathInline", "mathBlock"].includes(selection.node.type.name)) return false;
        const input = document.getElementById(MATH_INPUT_ID);
        if (!input) return false;
        input.focus();
        return true;
      },
    };
  },
});

const VIEWS = new Map<string, Extensions[number]>([
  [MathInline.name, MathInlineView],
  [MathBlock.name, MathBlockView],
  [CrossRef.name, CrossRefView],
  [CaptionList.name, CaptionListView],
]);

/**
 * 에디터 화면에서 쓰는 확장 목록: 문서 스키마(`documentExtensions`)는 그대로 두고,
 * 화면 전용 NodeView(KaTeX 렌더링, 번호 표시)와 플러그인만 덧붙인다.
 */
export function editorExtensions(options: DocumentExtensionOptions = {}): Extensions {
  return [...documentExtensions(options).map((ext) => VIEWS.get(ext.name) ?? ext), ReportUi];
}
