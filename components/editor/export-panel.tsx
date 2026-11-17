"use client";

import { useState } from "react";
import type { DocumentFormat } from "@/components/editor/use-document-format";
import { Button } from "@/components/ui/button";
import type { ExportFormat } from "@/lib/validation/format";
import { messages } from "@/lib/messages";

/** Content-Disposition에서 파일 이름을 꺼낸다 (filename* 우선) */
function filenameOf(header: string | null, fallback: string): string {
  const star = header && /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // 아래로
    }
  }
  const plain = header && /filename="([^"]+)"/i.exec(header);
  return plain ? plain[1] : fallback;
}

/**
 * 내보내기 (SPEC 7.5): PDF(서식 반영) / DOCX / Markdown.
 * 서버가 저장된 문서와 서식으로 만들므로, 먼저 아직 저장하지 않은 본문과 서식을 저장한다.
 * `pdfEnabled`가 false면(Vercel 등 Chromium이 없는 배포, lib/features.ts) PDF 항목을 숨긴다.
 */
export function ExportPanel({
  format,
  docId,
  flush,
  pdfEnabled,
}: {
  format: DocumentFormat;
  docId: string;
  flush: () => Promise<unknown>;
  pdfEnabled: boolean;
}) {
  const t = messages.exporter;
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(kind: ExportFormat) {
    setBusy(kind);
    setStatus(null);
    try {
      await flush();
      if (!(await format.ensureSaved())) throw new Error(t.failed);
      const res = await fetch(`/api/docs/${docId}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: kind }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? t.failed);
      }
      const name = filenameOf(res.headers.get("content-disposition"), `document.${kind}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      // 바로 지우면 브라우저가 파일 이름(download 속성)을 읽기 전에 사라질 수 있다.
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 10_000);
      setStatus({ ok: true, text: t.done.replace("{name}", name) });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : t.failed });
    } finally {
      setBusy(null);
    }
  }

  const items: { kind: ExportFormat; label: string }[] = [
    ...(pdfEnabled ? [{ kind: "pdf" as const, label: t.pdf }] : []),
    { kind: "docx", label: t.docx },
    { kind: "md", label: t.md },
  ];

  return (
    <section aria-label={t.title} data-testid="export-panel" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">{t.title}</h2>
      <p className="text-xs text-muted-foreground">{pdfEnabled ? t.note : t.noteNoPdf}</p>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <Button key={item.kind} type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void run(item.kind)}>
            {busy === item.kind ? t.working : item.label}
          </Button>
        ))}
      </div>
      {status ? (
        <p role={status.ok ? "status" : "alert"} data-testid="export-status" className={status.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {status.text}
        </p>
      ) : null}
    </section>
  );
}
