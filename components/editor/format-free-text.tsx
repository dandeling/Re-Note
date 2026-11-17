"use client";

import { useId, useState } from "react";
import type { DocumentFormat } from "@/components/editor/use-document-format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";

/**
 * 서식 자유 텍스트 입력 (SPEC 7.3 (d)): "본문 함초롬바탕 10pt, 줄간격 160%…" → POST /api/ai/format
 * → 검증된 규칙 조각을 폼에 채운다. 저장(= 적용)은 사용자가 폼을 확인한 뒤 직접 누른다.
 */
export function FormatFreeText({ format }: { format: DocumentFormat }) {
  const t = messages.format.freeText;
  const id = useId();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = text.trim();
    if (!value || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await api<{ rules: unknown }>("/api/ai/format", { method: "POST", body: { text: value } });
      format.fill(res.rules);
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b pb-3" data-testid="format-free-text">
      <label htmlFor={id} className="text-sm font-semibold">
        {t.label}
      </label>
      <Textarea
        id={id}
        value={text}
        maxLength={2000}
        rows={3}
        placeholder={t.placeholder}
        onChange={(e) => setText(e.target.value)}
        className="min-h-16 resize-y text-sm"
      />
      <p className="text-xs text-muted-foreground">{t.hint}</p>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={pending || !text.trim()} onClick={() => void submit()}>
          {pending ? t.pending : t.submit}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
