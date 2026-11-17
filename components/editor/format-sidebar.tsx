"use client";

import type { Editor } from "@tiptap/core";
import { useState, type ReactNode } from "react";
import { ExportPanel } from "@/components/editor/export-panel";
import { FormatCheckPanel } from "@/components/editor/format-check-panel";
import { FormatFreeText } from "@/components/editor/format-free-text";
import { FormatPanel } from "@/components/editor/format-panel";
import type { DocumentFormat, FormatTab } from "@/components/editor/use-document-format";
import { Button } from "@/components/ui/button";
import { FORMAT_CSS, FORMAT_SCREEN_CSS } from "@/lib/format/css";
import { messages } from "@/lib/messages";

/**
 * 에디터 우측 패널: AI 도우미 / 서식 / 서식 검사 / 내보내기.
 * 서식 스타일시트(변수만 참조)도 여기서 한 번 넣는다. 변수 값은 `format.scopeProps`가 본문 래퍼에 준다.
 */
type Props = {
  format: DocumentFormat;
  editor: Editor | null;
  docId: string;
  /** 내보내기 전에 아직 서버에 가지 않은 본문을 저장한다 */
  flush: () => Promise<unknown>;
  /** AI 도우미 패널 (SPEC 5장: 에디터에서는 챗봇을 우측 패널로 고정) */
  chat?: ReactNode;
  /** 서버에서 PDF 내보내기를 할 수 있는가 (lib/features.ts, 서버 컴포넌트가 내려준다) */
  pdfExportEnabled: boolean;
};

export function FormatSidebar({ format, editor, docId, flush, chat, pdfExportEnabled }: Props) {
  const tabs: { id: FormatTab; label: string }[] = [
    ...(chat ? [{ id: "chat" as const, label: messages.chat.title }] : []),
    { id: "format", label: messages.format.tab },
    { id: "check", label: messages.format.check.tab },
    { id: "export", label: messages.exporter.tab },
  ];
  const { tab, setTab } = format;
  // 대화가 탭을 오가도 유지되도록, 한 번 연 AI 도우미는 숨기기만 하고 내리지 않는다.
  const [chatMounted, setChatMounted] = useState(false);
  if (tab === "chat" && !chatMounted) setChatMounted(true);

  return (
    <aside aria-label={messages.format.panelTitle} className={tab ? "flex w-full shrink-0 flex-col gap-2 lg:w-80" : "flex shrink-0 flex-col gap-2"}>
      {/* eslint-disable-next-line @next/next/no-css-tags -- 글꼴 @font-face는 API가 node_modules에서 읽어 제공한다 */}
      <link rel="stylesheet" href="/api/format-fonts" />
      <style>{FORMAT_CSS + FORMAT_SCREEN_CSS}</style>
      <div className={tab ? "flex flex-wrap gap-2" : "flex flex-wrap gap-2 lg:flex-col"}>
        {tabs.map((x) => (
          <Button
            key={x.id}
            type="button"
            size="sm"
            variant={tab === x.id ? "default" : "outline"}
            aria-expanded={tab === x.id}
            onClick={() => setTab(tab === x.id ? null : x.id)}
          >
            {x.label}
          </Button>
        ))}
      </div>
      {format.notice ? (
        <p role="status" data-testid="format-notice" className="text-xs text-muted-foreground">
          {format.notice}
        </p>
      ) : null}
      {format.error ? (
        <p role="alert" data-testid="format-error" className="text-xs text-destructive">
          {format.error}
        </p>
      ) : null}
      {chat && chatMounted ? (
        <div
          hidden={tab !== "chat"}
          data-testid="editor-chat"
          className="h-[min(40rem,calc(100vh-6rem))] overflow-hidden rounded-lg border lg:sticky lg:top-4"
        >
          {chat}
        </div>
      ) : null}
      {tab && tab !== "chat" ? (
        <section className="rounded-lg border bg-card p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          {tab === "format" ? (
            <div className="flex flex-col gap-3">
              <FormatFreeText format={format} />
              <FormatPanel format={format} />
            </div>
          ) : null}
          {tab === "check" ? <FormatCheckPanel format={format} editor={editor} /> : null}
          {tab === "export" ? <ExportPanel format={format} docId={docId} flush={flush} pdfEnabled={pdfExportEnabled} /> : null}
        </section>
      ) : null}
    </aside>
  );
}
