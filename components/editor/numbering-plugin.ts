import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { resolveCrossRef } from "@/lib/captions/cross-ref";
import { buildCaptionList } from "@/lib/captions/list";
import { attachedMathBlockId, formatEquationTag, numberItems } from "@/lib/captions/numbering";
import { isCaptionKind, type Numbering, type NumberingItem } from "@/lib/captions/types";

type NumberingState = { numbering: Numbering; decorations: DecorationSet };

export const numberingPluginKey = new PluginKey<NumberingState>("numbering");

/** 에디터의 현재 번호 (캡션·수식·참조가 모두 이 값을 본다) */
export function getNumbering(state: EditorState): Numbering {
  return numberingPluginKey.getState(state)?.numbering ?? { entries: [], byId: new Map() };
}

/** NodeView가 장식(decoration)에서 번호 정보를 꺼낼 때 쓴다. */
export type NumberSpec = { refLabel?: string; broken?: boolean; tag?: string; list?: string };

export function readNumberSpec(decorations: readonly Decoration[]): NumberSpec {
  for (const deco of decorations) {
    const spec = deco.spec as NumberSpec & { numbering?: boolean };
    if (spec?.numbering) return spec;
  }
  return {};
}

type Found = { captions: { pos: number; id: string }[]; refs: { pos: number; targetId: string }[]; math: { pos: number; size: number; id: string }[]; lists: { pos: number; size: number; kind: string }[] };

/** PM 문서에서 번호 대상을 모은다. `lib/captions`의 JSON 수집기와 같은 규칙. */
function collect(doc: PMNode): { items: NumberingItem[]; found: Found } {
  const items: NumberingItem[] = [];
  const found: Found = { captions: [], refs: [], math: [], lists: [] };
  const brief = (n: PMNode | null) => (n ? { type: n.type.name, id: String(n.attrs.id ?? "") } : null);
  doc.descendants((node, pos, parent, index) => {
    switch (node.type.name) {
      case "caption": {
        const kind = isCaptionKind(node.attrs.kind) ? node.attrs.kind : "figure";
        const item: NumberingItem = { type: "caption", kind, id: String(node.attrs.id ?? ""), text: node.textContent };
        if (kind === "equation" && parent) {
          const attachedTo = attachedMathBlockId(brief(parent.maybeChild(index - 1)), brief(parent.maybeChild(index + 1)));
          if (attachedTo) item.attachedTo = attachedTo;
        }
        items.push(item);
        found.captions.push({ pos, id: item.id });
        // 캡션 안의 상호 참조도 찾아야 하므로 안으로 들어간다.
        return true;
      }
      case "mathBlock":
        items.push({ type: "mathBlock", id: String(node.attrs.id ?? ""), latex: String(node.attrs.latex ?? "") });
        found.math.push({ pos, size: node.nodeSize, id: String(node.attrs.id ?? "") });
        return false;
      case "crossRef":
        found.refs.push({ pos, targetId: String(node.attrs.targetId ?? "") });
        return false;
      case "captionList":
        found.lists.push({ pos, size: node.nodeSize, kind: String(node.attrs.kind) });
        return false;
      default:
        return true;
    }
  });
  return { items, found };
}

function build(doc: PMNode): NumberingState {
  const { items, found } = collect(doc);
  const numbering = numberItems(items);
  const decorations: Decoration[] = [];

  for (const { pos, id } of found.captions) {
    const entry = numbering.byId.get(id);
    if (!entry) continue;
    const label = entry.captionLabel;
    decorations.push(
      Decoration.widget(
        pos + 1,
        () => {
          const span = document.createElement("span");
          span.className = "doc-caption-label";
          span.contentEditable = "false";
          span.textContent = `${label} `;
          return span;
        },
        { side: -1, key: `caption-label:${label}`, ignoreSelection: true },
      ),
    );
  }
  for (const { pos, targetId } of found.refs) {
    const ref = resolveCrossRef(numbering, targetId);
    decorations.push(Decoration.node(pos, pos + 1, {}, { numbering: true, refLabel: ref.label, broken: ref.broken }));
  }
  for (const { pos, size, id } of found.math) {
    const entry = numbering.byId.get(id);
    decorations.push(Decoration.node(pos, pos + size, {}, { numbering: true, tag: entry ? formatEquationTag(entry.number) : "" }));
  }
  for (const { pos, size, kind } of found.lists) {
    const entries = isCaptionKind(kind) ? buildCaptionList(numbering, kind) : [];
    decorations.push(Decoration.node(pos, pos + size, {}, { numbering: true, list: JSON.stringify(entries) }));
  }
  return { numbering, decorations: DecorationSet.create(doc, decorations) };
}

/** 문서가 바뀔 때마다 번호를 다시 계산하고, 캡션 머리·참조·수식 번호·목차에 반영한다. */
export function numberingPlugin(): Plugin<NumberingState> {
  return new Plugin<NumberingState>({
    key: numberingPluginKey,
    state: {
      init: (_config, state) => build(state.doc),
      apply: (tr, prev, _old, next) => (tr.docChanged ? build(next.doc) : prev),
    },
    props: {
      decorations(state) {
        return numberingPluginKey.getState(state)?.decorations;
      },
    },
  });
}
