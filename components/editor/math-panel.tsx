"use client";

import { NodeSelection, Selection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import katex from "katex";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyEasyTemplate, EASY_MAIN, EASY_MORE, easyToLatex, latexToEasy, type EasyTemplate } from "@/lib/easy-math";
import { insertSnippet, MATH_PALETTE, type PaletteItem } from "@/lib/math/palette";
import { messages } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { MATH_INPUT_ID } from "./editor-extensions";

const MATH_NODES = ["mathInline", "mathBlock"];

type InputMode = "easy" | "latex";

/* ---------- 새 수식을 어떤 입력 방식으로 열지 ----------
 * 툴바 버튼으로 넣은 새 수식은 쉬운 입력(또는 사용자가 마지막에 고른 방식)으로 연다.
 * `$$ `처럼 LaTeX 문법으로 만든 빈 수식과 이미 있는 수식은 LaTeX 직접 모드로 연다. */
const MODE_KEY = "renote:math-input-mode";
const REQUEST_TTL_MS = 2000;
const easyRequests = new WeakMap<Editor, number>();

/** 툴바에서 새 수식을 넣기 직전에 부른다: 곧 열릴 입력란을 쉬운 입력(선호 방식)으로 연다. */
export function requestEasyMath(editor: Editor) {
  easyRequests.set(editor, Date.now());
}

/** 읽기만 한다(StrictMode에서 상태 초기화가 두 번 불려도 같은 답). 지우는 것은 열린 뒤 effect에서. */
function hasEasyRequest(editor: Editor) {
  const at = easyRequests.get(editor);
  return at !== undefined && Date.now() - at < REQUEST_TTL_MS;
}

function preferredMode(): InputMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "latex" ? "latex" : "easy";
  } catch {
    return "easy";
  }
}

function rememberMode(mode: InputMode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // 저장소를 못 쓰면 다음에 기본값(쉬운 입력)으로 연다.
  }
}

/** KaTeX 검사: 통과하면 null, 아니면 오류 위치(모르면 -1) */
function latexError(latex: string, displayMode: boolean): { position: number } | null {
  try {
    katex.renderToString(latex, { displayMode, throwOnError: true });
    return null;
  } catch (err) {
    const position = (err as { position?: unknown }).position;
    return { position: typeof position === "number" ? position : -1 };
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
  const e = t.easy;
  const ids = { hint: useId(), keys: useId(), easyHint: useId(), mode: useId() };
  /** 열 때 비어 있던 수식 = 새로 넣는 중. Esc는 넣기를 취소한다. */
  const [isNew] = useState(() => !initial.trim());
  const [mode, setMode] = useState<InputMode>(() => (!initial.trim() && hasEasyRequest(editor) ? preferredMode() : "latex"));
  const [latex, setLatex] = useState(initial);
  const [easy, setEasy] = useState("");
  const [easyNote, setEasyNote] = useState<string | null>(null);
  const latexRef = useRef<HTMLTextAreaElement>(null);
  const easyRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const easySelRef = useRef<[number, number] | null>(null);

  const error = useMemo(() => (latex.trim() ? latexError(latex, block) : null), [latex, block]);
  const previewHtml = useMemo(
    () => (latex.trim() ? katex.renderToString(latex, { displayMode: block, throwOnError: false }) : null),
    [latex, block],
  );

  // 새로 넣은(빈) 수식은 바로 입력할 수 있게 초점을 준다 (처음 열 때만).
  const openedRef = useRef(false);
  useEffect(() => {
    easyRequests.delete(editor);
    if (openedRef.current) return;
    openedRef.current = true;
    if (!initial) (mode === "easy" ? easyRef.current : latexRef.current)?.focus();
  }, [editor, initial, mode]);

  // 팔레트로 넣은 뒤 커서를 조각 안(예: \frac{|}{})에 둔다.
  useEffect(() => {
    if (caretRef.current === null) return;
    latexRef.current?.setSelectionRange(caretRef.current, caretRef.current);
    caretRef.current = null;
  }, [latex]);

  // 쉬운 입력 틀을 넣은 뒤 빈칸을 골라 둔다.
  useEffect(() => {
    if (!easySelRef.current) return;
    easyRef.current?.setSelectionRange(...easySelRef.current);
    easySelRef.current = null;
  }, [easy]);

  /** 본문의 수식 노드에 LaTeX를 바로 반영한다 (저장 형식은 늘 LaTeX). */
  function pushLatex(next: string) {
    setLatex(next);
    const node = editor.state.doc.nodeAt(pos);
    if (!node || !MATH_NODES.includes(node.type.name)) return;
    if (node.attrs.latex === next) return;
    editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, "latex", next));
  }

  function changeEasy(next: string) {
    setEasy(next);
    setEasyNote(null);
    pushLatex(easyToLatex(next));
  }

  function switchMode(next: InputMode) {
    if (next === mode) return;
    rememberMode(next);
    setMode(next);
    if (next === "easy") {
      const back = latexToEasy(latex);
      // 쉬운 표기로 못 옮기면 LaTeX 원문을 그대로 둔다 (백슬래시가 있으면 easyToLatex가 그대로 돌려준다).
      setEasy(back ?? latex);
      setEasyNote(back === null ? e.cannotConvert : null);
    } else {
      setEasyNote(null);
    }
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

  /** 새로 넣던 수식을 넣지 않고 닫는다. */
  function cancel() {
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        const node = tr.doc.nodeAt(pos);
        if (!node || !MATH_NODES.includes(node.type.name)) return true;
        tr.delete(pos, pos + node.nodeSize);
        tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1));
        return true;
      })
      .run();
  }

  function onKeys(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (isNew) cancel();
      else finish();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finish();
    }
  }

  function pickLatex(item: PaletteItem) {
    const input = latexRef.current;
    const start = input?.selectionStart ?? latex.length;
    const end = input?.selectionEnd ?? latex.length;
    const next = insertSnippet(latex, start, end, item);
    caretRef.current = next.caret;
    pushLatex(next.value);
    input?.focus();
  }

  function pickEasy(item: EasyTemplate) {
    const input = easyRef.current;
    const start = input?.selectionStart ?? easy.length;
    const end = input?.selectionEnd ?? easy.length;
    const next = applyEasyTemplate(easy, start, end, item);
    easySelRef.current = [next.selStart, next.selEnd];
    changeEasy(next.value);
    input?.focus();
  }

  // 오류 안내: 쉬운 입력은 무엇이 문제인지 한국어로, LaTeX 직접 모드는 기존 문구 그대로.
  let errorText: string | null = null;
  if (error) {
    if (mode === "latex") errorText = t.invalid;
    else {
      // 바꾸지 못하고 원문이 그대로 남았을 때만 원문 위치를 짚어 줄 수 있다.
      const shown = latex === easy.trim();
      errorText =
        shown && error.position >= 0
          ? e.notUnderstood.replace("{part}", latex.slice(Math.max(0, error.position - 8), error.position + 8))
          : e.notUnderstoodGeneral;
    }
  }
  const keysText = isNew ? (mode === "easy" ? e.keysNew : e.keysNewLatex) : mode === "easy" ? e.keysEdit : t.hint;
  const describedBy = [errorText ? ids.hint : null, ids.keys, mode === "easy" ? ids.easyHint : null].filter(Boolean).join(" ");

  return (
    <section
      aria-label={t.panelLabel}
      data-testid="math-panel"
      // 입력란 밖(방식 전환·틀 버튼)에서 누른 Esc도 패널을 닫는다.
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (isNew) cancel();
        else finish();
      }}
      className="flex flex-col gap-2 border-b bg-muted/40 px-3 py-2">
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">{e.modeLabel}</legend>
        <span aria-hidden className="text-xs text-muted-foreground">
          {e.modeLabel}
        </span>
        <div className="inline-flex rounded-md border border-input bg-background p-0.5">
          {(["easy", "latex"] as const).map((m) => (
            <label
              key={m}
              className={cn(
                "cursor-pointer rounded px-2.5 py-1 text-xs font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              <input
                type="radio"
                name={ids.mode}
                value={m}
                checked={mode === m}
                onChange={() => switchMode(m)}
                className="sr-only"
              />
              {m === "easy" ? e.modeEasy : e.modeLatex}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-start gap-2">
        {mode === "easy" ? (
          <>
            <label htmlFor={MATH_INPUT_ID} className="pt-2 text-sm font-medium">
              {e.inputLabel}
            </label>
            <Input
              id={MATH_INPUT_ID}
              ref={easyRef}
              value={easy}
              spellCheck={false}
              autoComplete="off"
              placeholder={e.placeholder}
              aria-invalid={!!error}
              aria-describedby={describedBy}
              onChange={(event) => changeEasy(event.target.value)}
              onKeyDown={onKeys}
              className="min-w-0 flex-1 basis-64 font-mono aria-[invalid=true]:border-destructive"
            />
          </>
        ) : (
          <>
            <label htmlFor={MATH_INPUT_ID} className="pt-1.5 text-sm font-medium">
              {t.latexLabel}
            </label>
            <textarea
              id={MATH_INPUT_ID}
              ref={latexRef}
              value={latex}
              rows={block ? 2 : 1}
              spellCheck={false}
              aria-invalid={!!error}
              aria-describedby={describedBy}
              onChange={(event) => pushLatex(event.target.value)}
              onKeyDown={onKeys}
              className="min-w-0 flex-1 basis-64 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
            />
          </>
        )}
        {isNew ? (
          <Button type="button" size="sm" variant="outline" onClick={cancel}>
            {e.cancel}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant={isNew ? "default" : "outline"} onClick={finish}>
          {isNew ? e.insert : t.done}
        </Button>
      </div>

      {mode === "easy" ? (
        <p id={ids.easyHint} className="text-xs text-muted-foreground">
          {easyNote ?? e.hint}
        </p>
      ) : null}

      <div
        role="group"
        aria-label={e.preview}
        data-testid="math-preview"
        className="flex min-h-14 max-w-full items-center justify-center overflow-x-auto rounded-md border bg-background px-3 py-2 text-lg"
      >
        {previewHtml ? (
          // KaTeX가 만든 HTML (입력은 KaTeX가 이스케이프하고, trust 옵션은 켜지 않는다)
          <span dangerouslySetInnerHTML={{ __html: previewHtml }} />
        ) : (
          <span className="text-sm text-muted-foreground">{e.previewEmpty}</span>
        )}
      </div>
      {mode === "easy" && latex.trim() ? (
        <p className="text-xs text-muted-foreground">
          {e.converted}: <code data-testid="math-converted" className="break-all font-mono text-foreground">{latex}</code>
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {errorText ? (
          <span id={ids.hint} role="alert" className="mr-2 text-destructive">
            {errorText}
          </span>
        ) : null}
        <span id={ids.keys}>{keysText}</span>
      </p>

      {mode === "easy" ? <EasyPalette onPick={pickEasy} /> : <MathPalette onPick={pickLatex} />}
    </section>
  );
}

/** 쉬운 입력용 틀·기호 버튼. 줄마다 Tab 한 번에 들어가고, 안에서는 화살표로 움직인다. */
function EasyPalette({ onPick }: { onPick: (item: EasyTemplate) => void }) {
  const e = messages.math.easy;
  const [more, setMore] = useState(false);
  const moreId = useId();
  return (
    <div className="flex flex-col gap-1">
      <ToolbarRow label={e.templatesLabel} items={EASY_MAIN} onPick={onPick}>
        <button
          type="button"
          aria-expanded={more}
          aria-controls={moreId}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setMore((v) => !v)}
          className="inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {more ? e.less : e.more}
        </button>
      </ToolbarRow>
      <div id={moreId} hidden={!more} className="flex flex-col gap-1">
        <ToolbarRow label={e.moreLabel} items={EASY_MORE} onPick={onPick} />
        <p className="text-xs text-muted-foreground">{e.cheat}</p>
      </div>
    </div>
  );
}

function ToolbarRow({
  label,
  items,
  onPick,
  children,
}: {
  label: string;
  items: EasyTemplate[];
  onPick: (item: EasyTemplate) => void;
  children?: React.ReactNode;
}) {
  const [active, setActive] = useState(0);
  const rowRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(rowRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const j =
      event.key === "ArrowRight" ? i + 1 : event.key === "ArrowLeft" ? i - 1 : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
    if (j === null) return;
    event.preventDefault();
    const k = (j + buttons.length) % buttons.length;
    setActive(k);
    buttons[k].focus();
  }

  return (
    <div ref={rowRef} role="toolbar" aria-label={label} onKeyDown={onKeyDown} className="flex flex-wrap items-center gap-1">
      {items.map((item, n) => (
        <button
          key={item.tpl}
          type="button"
          tabIndex={n === active ? 0 : -1}
          title={item.name ? `${item.name}: ${item.tpl.replace(/▢/g, "□")}` : item.tpl}
          aria-label={item.name ?? item.label}
          // 입력란의 커서 위치를 잃지 않도록 mousedown에서는 초점을 옮기지 않는다.
          onMouseDown={(event) => event.preventDefault()}
          onFocus={() => setActive(n)}
          onClick={() => onPick(item)}
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-input bg-background px-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {item.label}
        </button>
      ))}
      {children ? (
        <span onFocus={() => setActive(items.length)} className="contents">
          {children}
        </span>
      ) : null}
    </div>
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
