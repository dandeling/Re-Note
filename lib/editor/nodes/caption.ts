import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import {
  CAPTION_TARGET_NODE,
  captionKindForNode,
  captionPosition,
  DEFAULT_CAPTION_POSITIONS,
  isCaptionKind,
  type CaptionKind,
  type CaptionPositions,
} from "@/lib/captions/types";
import { newNodeId, uniqueIdPlugin } from "./ids";

export type CaptionOptions = {
  /** 캡션 위치 규칙 (서식 템플릿이 바꿀 수 있다) */
  positions: Partial<CaptionPositions>;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    caption: {
      /**
       * 선택한 그림·표·블록 수식에 캡션을 넣고 커서를 캡션 안에 둔다.
       * 이미 캡션이 있으면 그 캡션으로 커서만 옮긴다. 대상이 없으면 아무 일도 하지 않는다.
       */
      insertCaption: (options?: { positions?: Partial<CaptionPositions>; text?: string }) => ReturnType;
    };
    captionList: {
      /** 그림 목차 / 표 목차 블록을 넣는다. 내용은 문서의 캡션에서 자동으로 만들어진다. */
      insertCaptionList: (kind: CaptionKind) => ReturnType;
    };
  }
}

export type CaptionTarget = { pos: number; node: PMNode; kind: CaptionKind };

/** 현재 선택에서 캡션을 붙일 대상(그림·표·블록 수식)을 찾는다. */
export function findCaptionTarget(state: EditorState): CaptionTarget | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    const kind = captionKindForNode(selection.node.type.name);
    if (kind) return { pos: selection.from, node: selection.node, kind };
  }
  const { $from } = selection;
  // 블록 사이의 틈 커서(그림 바로 앞·뒤를 눌렀을 때): 맞닿은 대상을 고른 것으로 본다.
  if (selection.empty && !$from.parent.isTextblock) {
    for (const [node, pos] of [
      [$from.nodeAfter, $from.pos],
      [$from.nodeBefore, $from.pos - ($from.nodeBefore?.nodeSize ?? 0)],
    ] as const) {
      const kind = node ? captionKindForNode(node.type.name) : null;
      if (node && kind) return { pos, node, kind };
    }
  }
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "caption") return null;
    const kind = captionKindForNode(node.type.name);
    if (kind) return { pos: $from.before(depth), node, kind };
  }
  return null;
}

/**
 * 캡션이 가리키는 대상의 형제 인덱스. 위치 규칙에 맞는 쪽(그림은 앞, 표는 뒤)을 먼저 보고,
 * 없으면 반대쪽을 본다. 붙어 있는 대상이 없으면 null.
 */
export function captionTargetIndex(parent: PMNode, captionIndex: number, positions: Partial<CaptionPositions> = {}): number | null {
  const caption = parent.child(captionIndex);
  const kind: CaptionKind = isCaptionKind(caption.attrs.kind) ? caption.attrs.kind : "figure";
  const targetType = CAPTION_TARGET_NODE[kind];
  const isTarget = (i: number) => i >= 0 && i < parent.childCount && parent.child(i).type.name === targetType;
  const preferred = captionPosition(kind, positions) === "below" ? captionIndex - 1 : captionIndex + 1;
  const other = preferred < captionIndex ? captionIndex + 1 : captionIndex - 1;
  if (isTarget(preferred)) return preferred;
  if (!isTarget(other)) return null;
  // 반대쪽 대상에 이미 제자리 캡션이 있으면 그 대상은 내 것이 아니다.
  // (예: [그림2 캡션][그림3][그림3 캡션]에서 그림2 캡션이 그림3을 차지하면 안 된다.)
  const rival = other + (other - captionIndex);
  const claimed =
    rival >= 0 && rival < parent.childCount && parent.child(rival).type.name === "caption" && parent.child(rival).attrs.kind === caption.attrs.kind;
  return claimed ? null : other;
}

/** 대상(형제 인덱스)에 붙은 캡션의 형제 인덱스. 없으면 null. */
export function captionIndexForTarget(parent: PMNode, targetIndex: number, positions: Partial<CaptionPositions> = {}): number | null {
  for (const i of [targetIndex + 1, targetIndex - 1]) {
    if (i < 0 || i >= parent.childCount || parent.child(i).type.name !== "caption") continue;
    if (captionTargetIndex(parent, i, positions) === targetIndex) return i;
  }
  return null;
}

function childOffset(parent: PMNode, index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += parent.child(i).nodeSize;
  return offset;
}

export const captionIntegrityPluginKey = new PluginKey("captionIntegrity");

/**
 * 대상(그림·표·블록 수식)이 지워지면 거기 붙어 있던 캡션도 함께 지운다.
 * 캡션이 남으면 번호가 줄지 않아 "그림을 지우면 번호가 당겨진다"가 성립하지 않기 때문.
 * 실행 취소·끌어 옮기기에서는 건드리지 않는다.
 */
export function captionIntegrityPlugin(positions: Partial<CaptionPositions> = {}): Plugin {
  return new Plugin({
    key: captionIntegrityPluginKey,
    appendTransaction(transactions, oldState, newState) {
      const changed = transactions.filter((tr) => tr.docChanged);
      if (!changed.length) return null;
      if (changed.some((tr) => tr.getMeta("history$") || tr.getMeta("uiEvent") === "drop")) return null;

      const map = (pos: number, assoc: number) => {
        for (const tr of changed) pos = tr.mapping.map(pos, assoc);
        return pos;
      };

      const orphans: { from: number; to: number }[] = [];
      const scan = (parent: PMNode, base: number) => {
        let offset = 0;
        for (let i = 0; i < parent.childCount; i++) {
          const child = parent.child(i);
          const childStart = base + offset;
          offset += child.nodeSize;
          if (child.type.name !== "caption") {
            if (!child.isTextblock && !child.isLeaf) scan(child, childStart + 1);
            continue;
          }
          const targetIndex = captionTargetIndex(parent, i, positions);
          if (targetIndex === null) continue;
          const targetStart = base + childOffset(parent, targetIndex);
          const targetEnd = targetStart + parent.child(targetIndex).nodeSize;
          if (map(targetEnd, -1) > map(targetStart, 1)) continue; // 대상이 남아 있다

          const mapped = map(childStart, 1);
          if (mapped >= newState.doc.content.size) continue;
          const now = newState.doc.nodeAt(mapped);
          if (!now || now.type.name !== "caption" || now.attrs.id !== child.attrs.id) continue;
          // 대상이 같은 자리에서 다른 것으로 바뀐 경우(예: 그림 교체)에는 캡션을 남긴다.
          const $pos = newState.doc.resolve(mapped);
          if (captionTargetIndex($pos.parent, $pos.index(), positions) !== null) continue;
          orphans.push({ from: mapped, to: mapped + now.nodeSize });
        }
      };
      scan(oldState.doc, 0);
      if (!orphans.length) return null;
      const tr = newState.tr;
      for (const { from, to } of orphans.sort((a, b) => b.from - a.from)) tr.delete(from, to);
      return tr;
    },
  });
}

export const Caption = Node.create<CaptionOptions>({
  name: "caption",
  group: "block",
  content: "inline*",
  defining: true,

  addOptions() {
    return { positions: DEFAULT_CAPTION_POSITIONS };
  },

  addAttributes() {
    return {
      kind: {
        default: "figure",
        parseHTML: (el) => (isCaptionKind(el.getAttribute("data-kind")) ? el.getAttribute("data-kind") : "figure"),
        renderHTML: (attrs) => ({ "data-kind": attrs.kind }),
      },
      id: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-id") ?? "",
        renderHTML: (attrs) => ({ "data-id": attrs.id }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'p[data-type="caption"]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes({ "data-type": "caption", class: "doc-caption" }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      insertCaption:
        (options = {}) =>
        ({ state, tr, dispatch }) => {
          const target = findCaptionTarget(state);
          if (!target) return false;
          const positions = { ...this.options.positions, ...options.positions };
          const $target = state.doc.resolve(target.pos);
          const parent = $target.parent;
          const index = $target.index();
          const parentStart = target.pos - childOffset(parent, index);

          const existing = captionIndexForTarget(parent, index, positions);
          if (existing !== null) {
            if (dispatch) {
              const captionPos = parentStart + childOffset(parent, existing);
              const end = captionPos + parent.child(existing).nodeSize - 1;
              tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView();
            }
            return true;
          }

          const insertAt = captionPosition(target.kind, positions) === "below" ? target.pos + target.node.nodeSize : target.pos;
          if (!parent.canReplaceWith(index, index, this.type)) return false;
          if (dispatch) {
            const content = options.text ? state.schema.text(options.text) : undefined;
            const caption = this.type.create({ kind: target.kind, id: newNodeId() }, content);
            tr.insert(insertAt, caption);
            tr.setSelection(TextSelection.create(tr.doc, insertAt + caption.nodeSize - 1)).scrollIntoView();
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-c": () => this.editor.commands.insertCaption(),
      // 캡션은 한 문단이다. Enter는 캡션을 나누지 않고 캡션(과 그 대상) 다음 줄로 나간다.
      Enter: () => {
        const { $from } = this.editor.state.selection;
        if ($from.parent.type !== this.type) return false;
        const parent = $from.node($from.depth - 1);
        const index = $from.index($from.depth - 1);
        let after = $from.after();
        if (captionTargetIndex(parent, index, this.options.positions) === index + 1) after += parent.child(index + 1).nodeSize;
        return this.editor
          .chain()
          .insertContentAt(after, { type: "paragraph" })
          .setTextSelection(after + 1)
          .scrollIntoView()
          .run();
      },
    };
  },

  addProseMirrorPlugins() {
    return [uniqueIdPlugin(["caption", "mathBlock"]), captionIntegrityPlugin(this.options.positions)];
  },
});

/** 다른 기능(CSV 표·그래프 삽입 등)이 대상과 함께 넣을 캡션 JSON */
export function captionJSON(kind: CaptionKind, text = "") {
  return {
    type: "caption",
    attrs: { kind, id: newNodeId() },
    ...(text ? { content: [{ type: "text", text }] } : {}),
  };
}

/** 그림 목차 / 표 목차. 내용은 저장하지 않고 문서의 캡션에서 계산한다. */
export const CaptionList = Node.create({
  name: "captionList",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      kind: {
        default: "figure",
        parseHTML: (el) => (isCaptionKind(el.getAttribute("data-kind")) ? el.getAttribute("data-kind") : "figure"),
        renderHTML: (attrs) => ({ "data-kind": attrs.kind }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="caption-list"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "caption-list", class: "doc-caption-list" }, HTMLAttributes)];
  },

  addCommands() {
    return {
      insertCaptionList:
        (kind) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { kind } }),
    };
  },
});
