"use client";

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { messages } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { applyCrossRefSuggestion, getCrossRefSuggestion } from "./cross-ref-suggest";

/** 본문에서 `@그림`을 입력하면 커서 아래에 뜨는 참조 대상 목록. 키 입력은 에디터 플러그인이 처리한다. */
export function CrossRefPicker({ editor }: { editor: Editor }) {
  const t = messages.captions;
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = getCrossRefSuggestion(e.state);
      if (!s || !e.isFocused) return null;
      let left = 0;
      let top = 0;
      try {
        const coords = e.view.coordsAtPos(s.from);
        left = Math.round(coords.left);
        top = Math.round(coords.bottom);
      } catch {
        return null; // 아직 화면에 붙지 않았다
      }
      return {
        left,
        top,
        index: s.index,
        items: s.items.map((item) => ({ id: item.id, label: item.captionLabel, text: item.text || item.latex || "" })),
      };
    },
  });
  if (!state) return null;

  return (
    <div
      data-testid="cross-ref-picker"
      className="fixed z-50 mt-1 w-80 max-w-[90vw] rounded-md border bg-card text-sm shadow-lg"
      style={{ left: state.left, top: state.top }}
    >
      {state.items.length ? (
        <>
          <ul role="listbox" aria-label={t.pickerLabel} className="max-h-60 overflow-y-auto p-1">
            {state.items.map((item, i) => (
              <li
                key={item.id}
                role="option"
                aria-selected={i === state.index}
                ref={i === state.index ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                // mousedown에서 처리해야 에디터가 초점을 잃지 않는다.
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyCrossRefSuggestion(editor.view, item.id);
                }}
                className={cn("flex cursor-pointer gap-2 rounded px-2 py-1.5", i === state.index && "bg-accent text-primary")}
              >
                <span className="shrink-0 font-semibold">{item.label}</span>
                <span className="truncate text-muted-foreground">{item.text || t.noCaptionText}</span>
              </li>
            ))}
          </ul>
          <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">{t.pickerHint}</p>
        </>
      ) : (
        <p role="status" className="px-3 py-2 text-muted-foreground">
          {t.pickerEmpty}
        </p>
      )}
    </div>
  );
}
