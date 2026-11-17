import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { AUTOCOMPLETE_MIN_PARAGRAPH_CHARS, clipBefore } from "@/lib/editor/autocomplete-text";

/**
 * 글쓰기 자동완성 (ghost text).
 *
 * 제안은 플러그인 상태와 위젯 Decoration으로만 그린다. 문서(doc)에는 들어가지 않으므로
 * getJSON()을 쓰는 자동 저장·로컬 초안·스냅샷·내보내기에 섞이지 않는다. Tab을 눌러야 비로소 문서에 들어간다.
 *
 * - 입력이 멈추고 debounceMs가 지나면 요청한다 (커서가 문단 끝, 선택 없음, 문단 글자 10자 이상).
 * - 새 입력·커서 이동·포커스 이탈이 오면 제안을 지우고 진행 중 요청을 AbortController로 취소한다.
 * - 한글 IME 조합 중(view.composing)에는 요청도 표시도 하지 않는다.
 * - 표·코드 블록 안, 문단이 아닌 블록(제목·캡션 등)에서는 동작하지 않는다. 수식은 원자 노드라 커서가 들어가지 않는다.
 * - Tab: 받아들이기, Esc: 닫기, Ctrl+Space: 바로 요청 (mac에서도 Ctrl).
 */

export type AutocompleteContext = { before: string; section: string };

export type AutocompleteOptions = {
  debounceMs: number;
  /** 제안을 가져온다. 빈 문자열이면 아무것도 보이지 않는다. 실패해도 throw하지 말고 빈 문자열을 돌려준다. */
  fetchSuggestion: (ctx: AutocompleteContext, signal: AbortSignal) => Promise<string>;
  /** 지금 자동완성을 해도 되는지 (토글·가용성·한도) */
  isEnabled: () => boolean;
  /** 제안이 나타나거나(text) 사라질 때(null) 알린다 (aria-live 안내용) */
  onChange: (text: string | null) => void;
  /** 처음 한 번 "Tab으로 받아들이기" 힌트를 보여 줄지. true를 돌려준 뒤로는 보여 준 것으로 친다. */
  takeHint: () => boolean;
  hintText: string;
};

type GhostState = { text: string | null; pos: number; hint: boolean };
type GhostMeta = { type: "show"; text: string; pos: number; hint: boolean } | { type: "clear" };

export const autocompletePluginKey = new PluginKey<GhostState>("autocomplete");

const EMPTY: GhostState = { text: null, pos: 0, hint: false };
/** 자동완성을 하지 않는 조상 노드 */
const BLOCKED_ANCESTORS = new Set(["table", "tableRow", "tableCell", "tableHeader", "codeBlock", "mathBlock", "mathInline", "caption"]);

/** 지금 커서 위치에서 자동완성을 할 수 있으면 요청할 문맥을, 아니면 null을 돌려준다. */
export function autocompleteContext(state: EditorState, minChars = AUTOCOMPLETE_MIN_PARAGRAPH_CHARS): AutocompleteContext | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $pos = selection.$from;
  const parent = $pos.parent;
  if (parent.type.name !== "paragraph") return null;
  if ($pos.parentOffset !== parent.content.size) return null;
  for (let d = $pos.depth; d > 0; d--) if (BLOCKED_ANCESTORS.has($pos.node(d).type.name)) return null;
  if (parent.textContent.trim().length < minChars) return null;

  const pos = $pos.pos;
  const before = clipBefore(state.doc.textBetween(0, pos, "\n", " "));
  let section = "";
  state.doc.forEach((node: PMNode, offset: number) => {
    if (offset < pos && node.type.name === "heading") section = node.textContent;
  });
  return { before, section };
}

function ghostWidget(text: string, hint: string | null) {
  const span = document.createElement("span");
  span.className = "doc-autocomplete-ghost";
  span.dataset.testid = "autocomplete-ghost";
  span.setAttribute("aria-hidden", "true");
  span.contentEditable = "false";
  span.style.opacity = "0.45";
  span.style.pointerEvents = "none";
  span.style.userSelect = "none";
  span.style.whiteSpace = "pre-wrap";
  span.textContent = text;
  if (hint) {
    const badge = document.createElement("span");
    badge.dataset.testid = "autocomplete-hint";
    badge.textContent = hint;
    badge.style.cssText =
      "margin-left:0.5em;padding:0 0.4em;border:1px solid currentColor;border-radius:4px;font-size:0.75em;white-space:nowrap;";
    span.append(badge);
  }
  return span;
}

export const Autocomplete = Extension.create<AutocompleteOptions>({
  name: "autocomplete",
  // 목록의 Tab(들여쓰기)·키보드 탈출 Esc보다 먼저 제안을 처리한다. 제안이 없으면 그대로 넘긴다.
  priority: 1000,

  addOptions() {
    return {
      debounceMs: 1200,
      fetchSuggestion: async () => "",
      isEnabled: () => false,
      onChange: () => {},
      takeHint: () => false,
      hintText: "Tab",
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let viewRef: EditorView | null = null;

    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      controller?.abort();
      controller = null;
    };

    const clear = (view: EditorView) => {
      if (autocompletePluginKey.getState(view.state)?.text == null) return;
      view.dispatch(view.state.tr.setMeta(autocompletePluginKey, { type: "clear" } satisfies GhostMeta));
    };

    const request = async (view: EditorView) => {
      cancel();
      if (view.composing || !view.hasFocus() || !options.isEnabled()) return;
      const ctx = autocompleteContext(view.state);
      if (!ctx) return;
      const doc = view.state.doc;
      const pos = view.state.selection.from;
      const ac = new AbortController();
      controller = ac;
      let text = "";
      try {
        text = await options.fetchSuggestion(ctx, ac.signal);
      } catch {
        text = "";
      }
      if (controller === ac) controller = null;
      // 그사이 입력·커서 이동·조합·포커스 이탈·끄기가 있었으면 버린다.
      if (ac.signal.aborted || !text || viewRef !== view) return;
      if (view.state.doc !== doc || view.state.selection.from !== pos || !view.state.selection.empty) return;
      if (view.composing || !view.hasFocus() || !options.isEnabled()) return;
      const hint = options.takeHint();
      view.dispatch(view.state.tr.setMeta(autocompletePluginKey, { type: "show", text, pos, hint } satisfies GhostMeta));
    };

    const schedule = (view: EditorView) => {
      cancel();
      if (view.composing || !options.isEnabled()) return;
      if (!autocompleteContext(view.state)) return;
      timer = setTimeout(() => {
        timer = null;
        void request(view);
      }, options.debounceMs);
    };

    return [
      new Plugin<GhostState>({
        key: autocompletePluginKey,
        state: {
          init: () => EMPTY,
          apply(tr: Transaction, value: GhostState): GhostState {
            const meta = tr.getMeta(autocompletePluginKey) as GhostMeta | undefined;
            if (meta?.type === "show") return { text: meta.text, pos: meta.pos, hint: meta.hint };
            if (meta?.type === "clear") return EMPTY;
            if (value.text == null) return value;
            // 문서가 바뀌거나 커서가 움직이면 제안을 지운다.
            if (tr.docChanged || tr.selectionSet) return EMPTY;
            return value;
          },
        },
        props: {
          decorations(state) {
            const ghost = autocompletePluginKey.getState(state);
            if (!ghost?.text) return null;
            const hint = ghost.hint ? options.hintText : null;
            return DecorationSet.create(state.doc, [
              Decoration.widget(ghost.pos, () => ghostWidget(ghost.text!, hint), {
                side: 1,
                ignoreSelection: true,
                key: `ac:${ghost.pos}:${ghost.hint ? 1 : 0}:${ghost.text}`,
              }),
            ]);
          },
          handleKeyDown(view, event) {
            if (event.isComposing || view.composing) return false;
            // Ctrl+Space: 바로 요청 (mac에서도 Ctrl. Cmd+Space는 운영체제가 쓴다)
            if (event.ctrlKey && !event.metaKey && !event.altKey && (event.code === "Space" || event.key === " ")) {
              event.preventDefault();
              clear(view);
              void request(view);
              return true;
            }
            const ghost = autocompletePluginKey.getState(view.state);
            if (!ghost?.text) return false;
            const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
            if (event.key === "Tab" && plain) {
              event.preventDefault();
              const tr = view.state.tr.insertText(ghost.text, ghost.pos).setMeta(autocompletePluginKey, { type: "clear" });
              view.dispatch(tr.scrollIntoView());
              return true;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
              clear(view);
              return true;
            }
            return false;
          },
          handleDOMEvents: {
            compositionstart(view) {
              cancel();
              clear(view);
              return false;
            },
            compositionend(view) {
              // 조합이 끝난 뒤의 트랜잭션이 반영된 다음에 예약한다.
              setTimeout(() => {
                if (viewRef === view && !view.composing) schedule(view);
              }, 0);
              return false;
            },
            blur(view) {
              cancel();
              clear(view);
              return false;
            },
          },
        },
        view(view) {
          viewRef = view;
          let last: GhostState["text"] = null;
          return {
            update(view, prev) {
              const ghost = autocompletePluginKey.getState(view.state);
              const text = ghost?.text ?? null;
              if (text !== last) {
                last = text;
                options.onChange(text);
              }
              const changed = view.state.doc !== prev.doc || !view.state.selection.eq(prev.selection);
              if (!changed) return;
              if (view.composing) {
                cancel();
                return;
              }
              // 받아들인 직후에도 다음 제안을 예약한다 (입력이 멈추면).
              if (view.hasFocus()) schedule(view);
              else cancel();
            },
            destroy() {
              cancel();
              if (viewRef === view) viewRef = null;
              if (last !== null) options.onChange(null);
            },
          };
        },
      }),
    ];
  },
});

/** 화면에 떠 있는 제안을 지운다 (토글을 끌 때 등). */
export function clearAutocomplete(view: EditorView) {
  if (autocompletePluginKey.getState(view.state)?.text == null) return;
  view.dispatch(view.state.tr.setMeta(autocompletePluginKey, { type: "clear" } satisfies GhostMeta));
}
