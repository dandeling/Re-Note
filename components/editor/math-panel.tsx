"use client";

import { NodeSelection, Selection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import katex from "katex";
import { useEffect, useMemo, useRef, useState } from "react";
import { insertSnippet, MATH_PALETTE, type PaletteItem } from "@/lib/math/palette";
import { messages } from "@/lib/messages";
import { MATH_INPUT_ID } from "./editor-extensions";

const MATH_NODES = ["mathInline", "mathBlock"];

function isValidLatex(latex: string, displayMode: boolean) {
  try {
    katex.renderToString(latex, { displayMode, throwOnError: true });
    return true;
  } catch {
    return false;
  }
}

/** 수식 노드를 선택하면 툴바 아래에 뜨는 편집 패널. 입력하는 대로 본문의 수식이 다시 그려진다. */
export function MathPanel({ editor }: { editor: Editor }) {
  const selected = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { selection } = e.state;
      if (!(selection instanceof NodeSelection) || !MATH_NODES.includes(selection.node.type.name)) return null;
      return { pos: selection.from, block: selection.node.type.name === "mathBlock", latex: String(selection.node.attrs.latex) };
    },
  });
  if (!selected) return null;
  return <MathForm key={selected.pos} editor={editor} pos={selected.pos} block={selected.block} initial={selected.latex} />;
}

function MathForm({ editor, pos, block, initial }: { editor: Editor; pos: number; block: boolean; initial: string }) {
  const t = messages.math;
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
  const valid = useMemo(() => !value.trim() || isValidLatex(value, block), [value, block]);

  // 새로 넣은(빈) 수식은 바로 입력할 수 있게 초점을 준다.
  useEffect(() => {
    if (!initial) inputRef.current?.focus();
  }, [initial]);

  // 팔레트로 넣은 뒤 커서를 조각 안(예: \frac{|}{})에 둔다.
  useEffect(() => {
    if (caretRef.current === null) return;
    inputRef.current?.setSelectionRange(caretRef.current, caretRef.current);
    caretRef.current = null;
  }, [value]);

  function change(next: string) {
    setValue(next);
    const node = editor.state.doc.nodeAt(pos);
    if (!node || !MATH_NODES.includes(node.type.name)) return;
    editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, "latex", next));
  }

  /** 편집을 마치고 본문으로 돌아간다. 빈 수식은 지운다. */
  function finish() {
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        const node = tr.doc.nodeAt(pos);
        if (!node || !MATH_NODES.includes(node.type.name)) return true;
        if (!String(node.attrs.latex).trim()) {
          tr.delete(pos, pos + node.nodeSize);
          tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1));
        } else {
          tr.setSelection(Selection.near(tr.doc.resolve(pos + node.nodeSize), 1));
        }
        return true;
      })
      .run();
  }

  function pick(item: PaletteItem) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const next = insertSnippet(value, start, end, item);
    caretRef.current = next.caret;
    change(next.value);
    input?.focus();
  }

  return (
    <section aria-label={t.panelLabel} data-testid="math-panel" className="flex flex-col gap-2 border-b bg-muted/40 px-3 py-2">
      <div className="flex flex-wrap items-start gap-2">
        <label htmlFor={MATH_INPUT_ID} className="pt-1.5 text-sm font-medium">
          {t.latexLabel}
        </label>
        <textarea
          id={MATH_INPUT_ID}
          ref={inputRef}
          value={value}
          rows={block ? 2 : 1}
          spellCheck={false}
          aria-invalid={!valid}
          aria-describedby="math-latex-hint"
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) {
              event.preventDefault();
              finish();
            }
          }}
          className="min-w-0 flex-1 basis-64 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
        />
        <button
          type="button"
          onClick={finish}
          className="h-8 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.done}
        </button>
      </div>
      <p id="math-latex-hint" className="text-xs text-muted-foreground">
        {valid ? t.hint : <span role="alert" className="text-destructive">{t.invalid}</span>}
      </p>
      <MathPalette onPick={pick} />
    </section>
  );
}

function MathPalette({ onPick }: { onPick: (item: PaletteItem) => void }) {
  const t = messages.math;
  // 버튼 그림은 고정된 LaTeX 상수에서만 만든다 (사용자 입력이 섞이지 않는다).
  const groups = useMemo(
    () =>
      MATH_PALETTE.map((group) => ({
        key: group.key,
        items: group.items.map((item) => ({
          item,
          name: item.name ? t.items[item.name] : item.latex.trim(),
          html: katex.renderToString(item.preview ?? item.latex, { throwOnError: false }),
        })),
      })),
    [t],
  );

  return (
    <div role="group" aria-label={t.paletteLabel} className="flex flex-col gap-1">
      {groups.map((group) => (
        <div key={group.key} role="group" aria-label={t.groups[group.key]} className="flex flex-wrap items-center gap-1">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">{t.groups[group.key]}</span>
          {group.items.map(({ item, name, html }) => (
            <button
              key={item.latex}
              type="button"
              title={name}
              aria-label={name}
              // 입력란의 커서 위치를 잃지 않도록 mousedown에서는 초점을 옮기지 않는다.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(item)}
              className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-transparent px-1.5 text-sm hover:border-input hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_.katex]:text-[0.85em]"
            >
              <span aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
