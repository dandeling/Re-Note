import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { filterRefTargets, isKindQuery, parseRefTrigger } from "@/lib/captions/cross-ref";
import type { NumberedEntry } from "@/lib/captions/types";
import { getNumbering } from "./numbering-plugin";

type SuggestState = {
  /** `@`의 문서 위치. 참조 입력 중이 아니면 null */
  from: number | null;
  to: number;
  query: string;
  index: number;
  /** Esc로 닫은 `@`의 위치. 그 입력이 끝날 때까지 다시 열지 않는다. */
  dismissed: number | null;
};

type Meta = { type: "move"; index: number } | { type: "dismiss" };

export const crossRefSuggestKey = new PluginKey<SuggestState>("crossRefSuggest");

const CLOSED: SuggestState = { from: null, to: 0, query: "", index: 0, dismissed: null };

function detect(state: EditorState): { from: number; to: number; query: string } | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  if ($from.marks().some((mark) => mark.type.spec.code)) return null;
  // 원자 노드(참조·수식)는 한 글자 자리로 쳐서 문서 위치와 문자열 인덱스를 맞춘다.
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const trigger = parseRefTrigger(before);
  if (!trigger) return null;
  return { from: $from.start() + trigger.start, to: $from.pos, query: trigger.query };
}

export type CrossRefSuggestion = {
  from: number;
  to: number;
  query: string;
  items: NumberedEntry[];
  index: number;
};

/** 지금 보여 줄 참조 고르기 목록. 닫혀 있으면 null. */
export function getCrossRefSuggestion(state: EditorState): CrossRefSuggestion | null {
  const s = crossRefSuggestKey.getState(state);
  if (!s || s.from === null || s.dismissed === s.from) return null;
  const items = filterRefTargets(getNumbering(state).entries, s.query);
  // 대상이 없을 때는 `@그림`처럼 참조를 넣으려는 입력에만 안내를 띄운다 (`@홍길동` 같은 글은 방해하지 않는다).
  if (!items.length && !isKindQuery(s.query)) return null;
  return { from: s.from, to: s.to, query: s.query, items, index: items.length ? Math.min(s.index, items.length - 1) : 0 };
}

/** 목록에서 고른 대상을 `@…` 자리에 상호 참조로 넣는다. */
export function applyCrossRefSuggestion(view: EditorView, targetId: string): boolean {
  const s = getCrossRefSuggestion(view.state);
  const type = view.state.schema.nodes.crossRef;
  if (!s || !type || !targetId) return false;
  view.dispatch(view.state.tr.replaceWith(s.from, s.to, type.create({ targetId })).scrollIntoView());
  view.focus();
  return true;
}

export function crossRefSuggestPlugin(): Plugin<SuggestState> {
  return new Plugin<SuggestState>({
    key: crossRefSuggestKey,
    state: {
      init: () => CLOSED,
      apply(tr, prev, _old, next) {
        const meta = tr.getMeta(crossRefSuggestKey) as Meta | undefined;
        const found = detect(next);
        if (!found) return prev.from === null && prev.dismissed === null ? prev : CLOSED;
        const dismissedBefore = prev.dismissed === null ? null : tr.mapping.map(prev.dismissed);
        const dismissed = meta?.type === "dismiss" ? found.from : dismissedBefore === found.from ? found.from : null;
        let index = found.from === (prev.from === null ? null : tr.mapping.map(prev.from)) && found.query === prev.query ? prev.index : 0;
        if (meta?.type === "move") index = meta.index;
        return { ...found, index, dismissed };
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (event.isComposing) return false;
        const s = getCrossRefSuggestion(view.state);
        if (!s) return false;
        const send = (meta: Meta) => view.dispatch(view.state.tr.setMeta(crossRefSuggestKey, meta));
        switch (event.key) {
          case "ArrowDown":
          case "ArrowUp": {
            if (!s.items.length) return false;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            // 끝에서 한 번 더 누르면 반대쪽 끝으로 돈다.
            const nextIndex = (s.index + delta + s.items.length) % s.items.length;
            send({ type: "move", index: nextIndex });
            return true;
          }
          case "Enter":
          case "Tab":
            if (!s.items.length) return false;
            return applyCrossRefSuggestion(view, s.items[s.index].id);
          case "Escape":
            send({ type: "dismiss" });
            return true;
          default:
            return false;
        }
      },
    },
  });
}
