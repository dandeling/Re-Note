"use client";

import Link from "next/link";
import { type FormEvent, type KeyboardEvent, type ReactNode, type Ref, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChatSuggestion, Citation, InsertPayload } from "@/lib/ai/shared";
import { messages } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { useChat, type UiMessage } from "./use-chat";

export type ChatPanelProps = {
  /** 에디터에서 연 경우 현재 문서 ID. 내용은 서버가 소유자 검사 후 읽는다. */
  documentId?: string;
  /** 프로젝트에서 연 경우 프로젝트 ID. */
  projectId?: string;
  /** 보낼 때 에디터의 선택 영역 텍스트를 돌려준다 (없으면 undefined). */
  getSelection?: () => string | undefined;
  /**
   * 사용자가 제안의 "삽입" 버튼을 눌렀을 때만 호출된다. 자동으로 호출되는 일은 없다 (SPEC 7.4).
   * 없으면 삽입 버튼을 보여 주지 않는다.
   */
  onInsert?: (payload: InsertPayload) => void;
  /** 비로그인 상태면 입력 대신 로그인 안내를 보여 준다. */
  loggedIn?: boolean;
  /** 제목 줄 오른쪽에 둘 버튼 (예: 닫기) */
  headerActions?: ReactNode;
  inputRef?: Ref<HTMLTextAreaElement>;
  className?: string;
};

const t = messages.chat;

function Sources({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <nav aria-label={t.sources} className="mt-2 border-t pt-2">
      <p className="text-xs font-semibold text-muted-foreground">{t.sources}</p>
      <ul className="mt-1 space-y-1">
        {citations.map((c) => (
          <li key={c.path} className="text-sm">
            <span className="mr-1 rounded bg-secondary px-1 py-0.5 text-xs text-secondary-foreground">
              {c.kind === "research" ? t.sourceResearch : t.sourcePain}
            </span>
            <Link href={c.path} className="text-primary underline underline-offset-2 hover:no-underline">
              {c.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function suggestionView(payload: InsertPayload): { label: string; body: string; mono?: boolean } {
  switch (payload.kind) {
    case "text":
      return { label: payload.mode === "replace_selection" ? t.suggestionReplace : t.suggestionText, body: payload.content };
    case "latex":
      return { label: t.suggestionLatex, body: payload.latex, mono: true };
    case "format":
      return { label: t.suggestionFormat, body: JSON.stringify(payload.rules, null, 2), mono: true };
    case "chart": {
      const s = payload.suggestion;
      const axes = t.chartAxes.replace("{x}", s.x ?? "–").replace("{y}", s.y.join(", ") || "–");
      return { label: `${t.suggestionChart}: ${t.chartTypes[s.chartType]}`, body: `${axes}\n${s.reason}` };
    }
  }
}

function SuggestionCard({ suggestion, onInsert }: { suggestion: ChatSuggestion; onInsert?: (payload: InsertPayload) => void }) {
  const [inserted, setInserted] = useState(false);
  const view = suggestionView(suggestion.payload);
  return (
    <section aria-label={view.label} className="mt-2 rounded-md border bg-background p-2" data-testid="chat-suggestion">
      <p className="text-xs font-semibold text-muted-foreground">{view.label}</p>
      <p className={cn("mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm", view.mono && "font-mono text-xs")}>
        {view.body}
      </p>
      {onInsert ? (
        <Button
          type="button"
          size="sm"
          className="mt-2"
          disabled={inserted}
          onClick={() => {
            onInsert(suggestion.payload);
            setInserted(true);
          }}
        >
          {inserted ? t.inserted : t.insert}
        </Button>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">{t.insertHint}</p>
      )}
    </section>
  );
}

function statusText(status: UiMessage["status"]) {
  if (status === "searching") return t.searching;
  if (status === "working") return t.working;
  return t.writing;
}

function Bubble({ message, onInsert }: { message: UiMessage; onInsert?: (payload: InsertPayload) => void }) {
  const mine = message.role === "user";
  return (
    <li className={cn("flex flex-col", mine ? "items-end" : "items-start")} data-role={message.role}>
      <span className="sr-only">{mine ? t.you : t.assistant}</span>
      <div
        className={cn(
          "max-w-[90%] rounded-lg px-3 py-2 text-sm",
          mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {message.content ? <p className="whitespace-pre-wrap break-words" data-testid="chat-text">
            {message.content}
          </p> : null}
        {message.status ? (
          <p className="text-xs text-muted-foreground" data-testid="chat-status">
            {statusText(message.status)}
          </p>
        ) : null}
        {message.suggestions.map((s) => (
          <SuggestionCard key={s.id} suggestion={s} onInsert={onInsert} />
        ))}
        {!message.status ? <Sources citations={message.citations} /> : null}
      </div>
    </li>
  );
}

/**
 * AI 챗봇 패널 (SPEC 7.4). 전역 플로팅 창과 에디터 우측 패널에서 함께 쓴다.
 * 스트리밍 표시, 출처 링크, 스레드 이어가기, 제안의 "삽입" 버튼을 제공한다.
 */
export function ChatPanel({
  documentId,
  projectId,
  getSelection,
  onInsert,
  loggedIn = true,
  headerActions,
  inputRef,
  className,
}: ChatPanelProps) {
  const chat = useChat(loggedIn);
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLOListElement>(null);
  const inputId = useId();
  const threadsId = useId();

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.items]);

  function submit() {
    const text = draft.trim();
    if (!text || chat.busy) return;
    setDraft("");
    void chat.send(text, { documentId, projectId, selection: getSelection?.()?.trim() || undefined });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 조합 중의 Enter는 보내지 않는다.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <section aria-label={t.title} className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="flex-1 text-sm font-semibold">{t.title}</h2>
        {loggedIn ? (
          <Button type="button" variant="outline" size="sm" onClick={chat.newThread}>
            {t.newThread}
          </Button>
        ) : null}
        {headerActions}
      </header>

      {loggedIn && chat.threads.length > 0 ? (
        <div className="border-b px-3 py-2">
          <label htmlFor={threadsId} className="sr-only">
            {t.threadsLabel}
          </label>
          <select
            id={threadsId}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={chat.threadId && chat.threads.some((th) => th.id === chat.threadId) ? chat.threadId : ""}
            onChange={(e) => {
              if (e.target.value) void chat.openThread(e.target.value);
              else chat.newThread();
            }}
          >
            <option value="">{t.threadsCurrent}</option>
            {chat.threads.map((th) => (
              <option key={th.id} value={th.id}>
                {th.title || t.untitledThread}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <ol
        ref={logRef}
        role="log"
        aria-label={t.logLabel}
        aria-live="polite"
        aria-busy={chat.busy}
        tabIndex={0}
        className="flex-1 space-y-3 overflow-y-auto px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {chat.items.length === 0 ? <li className="text-sm text-muted-foreground">{t.empty}</li> : null}
        {chat.items.map((m) => (
          <Bubble key={m.key} message={m} onInsert={onInsert} />
        ))}
      </ol>

      {chat.error ? (
        <p role="alert" className="border-t px-3 py-2 text-sm text-destructive">
          {chat.error}
        </p>
      ) : null}

      {loggedIn ? (
        <form onSubmit={onSubmit} className="border-t p-3">
          <label htmlFor={inputId} className="sr-only">
            {t.inputLabel}
          </label>
          <Textarea
            id={inputId}
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t.placeholder}
            maxLength={4000}
            rows={2}
            className="min-h-16 resize-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <p className="flex-1 text-xs text-muted-foreground">{t.hint}</p>
            {chat.busy ? (
              <Button type="button" variant="outline" size="sm" onClick={chat.stop}>
                {t.stop}
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={chat.busy || !draft.trim()}>
              {t.send}
            </Button>
          </div>
        </form>
      ) : (
        <div className="border-t p-3 text-sm">
          <p>{t.loginRequired}</p>
          <Button asChild size="sm" className="mt-2">
            <Link href="/login">{t.loginLink}</Link>
          </Button>
        </div>
      )}
    </section>
  );
}
