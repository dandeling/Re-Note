"use client";

import type { Editor } from "@tiptap/react";
import katex from "katex";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ClipboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { insertSuggestedLatex } from "@/lib/editor/ai-insert";
import { messages } from "@/lib/messages";

/* 툴바 버튼(ReportTools)과 패널(ReportPanels)이 같은 열림 상태를 쓰도록 에디터별로 보관한다. */
const openState = new WeakMap<Editor, boolean>();
const listeners = new WeakMap<Editor, Set<() => void>>();

export function setMathAiOpen(editor: Editor, open: boolean) {
  openState.set(editor, open);
  listeners.get(editor)?.forEach((fn) => fn());
}

export function useMathAiOpen(editor: Editor) {
  return useSyncExternalStore(
    (fn) => {
      const set = listeners.get(editor) ?? new Set();
      listeners.set(editor, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    () => openState.get(editor) ?? false,
    () => false,
  );
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
/** 서버 한도(base64 약 7MB)에 맞춘 원본 크기 한도 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type LatexResult = { latex: string; display: "inline" | "block" };

/**
 * 자연어·이미지 → LaTeX (SPEC 7.3 (c)). 설명을 쓰거나 수식 캡처 이미지를 붙여넣기·선택하면
 * POST /api/ai/latex의 결과를 KaTeX로 미리 보여 주고, 사용자가 "수식 삽입"을 눌러야 문서에 넣는다.
 */
export function MathAiPanel({ editor }: { editor: Editor }) {
  const open = useMathAiOpen(editor);
  if (!open) return null;
  return <MathAiForm editor={editor} onClose={() => setMathAiOpen(editor, false)} />;
}

function MathAiForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = messages.math.ai;
  const ids = { desc: useId(), image: useId(), latex: useId(), hint: useId() };
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<LatexResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    descRef.current?.focus();
  }, []);

  const preview = useMemo(() => {
    if (!result?.latex.trim()) return null;
    try {
      // KaTeX의 신뢰 옵션은 켜지 않는다(기본값) — \href 등 위험한 명령은 그리지 않는다.
      return { ok: true, html: katex.renderToString(result.latex, { displayMode: result.display === "block", throwOnError: true }) };
    } catch {
      return { ok: false, html: "" };
    }
  }, [result]);

  async function request(body: { description: string } | { image: { mediaType: ImageType; data: string } }) {
    setPending(true);
    setError(null);
    try {
      setResult(await api<LatexResult>("/api/ai/latex", { method: "POST", body }));
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setPending(false);
    }
  }

  async function fromImage(file: File) {
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return setError(t.imageType);
    if (file.size > MAX_IMAGE_BYTES) return setError(t.imageTooLarge);
    await request({ image: { mediaType: file.type as ImageType, data: await toBase64(file) } });
  }

  function onPaste(e: ClipboardEvent) {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    void fromImage(file);
  }

  function insert() {
    if (!result || !preview?.ok) return;
    if (insertSuggestedLatex(editor, result.latex, result.display)) onClose();
  }

  return (
    <section
      aria-label={t.panelLabel}
      data-testid="math-ai-panel"
      onPaste={onPaste}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          editor.commands.focus();
        }
      }}
      className="flex flex-col gap-2 border-b bg-muted/40 px-3 py-2"
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (description.trim()) void request({ description: description.trim() });
        }}
      >
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <label htmlFor={ids.desc} className="text-sm font-medium">
            {t.describeLabel}
          </label>
          <Input
            id={ids.desc}
            ref={descRef}
            value={description}
            maxLength={1000}
            placeholder={t.describePlaceholder}
            aria-describedby={ids.hint}
            onChange={(e) => setDescription(e.target.value)}
            className="h-8"
          />
        </div>
        <Button type="submit" size="sm" disabled={pending || !description.trim()}>
          {pending ? t.generating : t.generate}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => fileRef.current?.click()}>
          {t.chooseImage}
        </Button>
        <input
          id={ids.image}
          ref={fileRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          aria-label={t.imageLabel}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void fromImage(file);
          }}
        />
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t.close}
        </Button>
      </form>
      <p id={ids.hint} className="text-xs text-muted-foreground">
        {t.hint}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t.generating}
        </p>
      ) : null}
      {result ? (
        <div className="flex flex-col gap-2 rounded-md border bg-background p-2">
          <label htmlFor={ids.latex} className="text-xs font-medium text-muted-foreground">
            {t.resultLabel}
          </label>
          <textarea
            id={ids.latex}
            value={result.latex}
            rows={2}
            spellCheck={false}
            aria-invalid={preview ? !preview.ok : false}
            onChange={(e) => setResult({ ...result, latex: e.target.value })}
            className="rounded-md border border-input bg-background px-2 py-1 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
          />
          <p className="text-xs font-medium text-muted-foreground">{t.preview}</p>
          {preview?.ok ? (
            <div
              role="img"
              aria-label={`${t.preview}: ${result.latex}`}
              data-testid="math-ai-preview"
              className="overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          ) : (
            <p role="alert" className="text-sm text-destructive">
              {messages.math.invalid}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <fieldset className="flex items-center gap-3 text-sm">
              <legend className="sr-only">{t.displayLabel}</legend>
              {(["inline", "block"] as const).map((d) => (
                <label key={d} className="flex items-center gap-1">
                  <input type="radio" name="math-ai-display" checked={result.display === d} onChange={() => setResult({ ...result, display: d })} />
                  {d === "inline" ? t.inline : t.block}
                </label>
              ))}
            </fieldset>
            <Button type="button" size="sm" disabled={!preview?.ok} onClick={insert}>
              {t.insert}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
