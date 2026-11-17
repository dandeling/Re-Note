"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent, ChatMessageView, ChatSuggestion, ChatThreadSummary, Citation } from "@/lib/ai/shared";
import { api, ApiClientError } from "@/lib/api-client";
import { messages } from "@/lib/messages";

export type UiMessage = {
  /** 화면용 키 (서버 ID가 정해지기 전에도 필요) */
  key: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  suggestions: ChatSuggestion[];
  /** 스트리밍 중일 때의 진행 상태 */
  status?: "writing" | "searching" | "working";
};

export type ChatContextInput = { documentId?: string; projectId?: string; selection?: string };

/** SSE 본문을 이벤트 단위로 읽는다. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        yield JSON.parse(data) as ChatEvent;
      } catch {
        // 깨진 프레임은 건너뛴다
      }
    }
  }
}

let keySeq = 0;
const nextKey = () => `m${(keySeq += 1)}`;

export function useChat(enabled: boolean) {
  const t = messages.chat;
  const [threadId, setThreadId] = useState<string | null>(null);
  const [items, setItems] = useState<UiMessage[]>([]);
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshThreads = useCallback(async () => {
    try {
      setThreads((await api<{ threads: ChatThreadSummary[] }>("/api/chat/threads")).threads);
    } catch {
      // 목록을 못 불러와도 대화는 계속할 수 있다
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api<{ threads: ChatThreadSummary[] }>("/api/chat/threads")
      .then((data) => {
        if (!cancelled) setThreads(data.threads);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    setThreadId(null);
    setItems([]);
    setError(null);
  }, []);

  const openThread = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      setError(null);
      try {
        const data = await api<{ messages: ChatMessageView[] }>(`/api/chat/threads/${id}`);
        setThreadId(id);
        setItems(data.messages.map((m) => ({ key: m.id, role: m.role, content: m.content, citations: m.citations, suggestions: [] })));
      } catch {
        setError(t.loadFailed);
      }
    },
    [t.loadFailed],
  );

  const send = useCallback(
    async (text: string, context: ChatContextInput) => {
      const message = text.trim();
      if (!message || busy) return;
      const replyKey = nextKey();
      const patch = (fn: (m: UiMessage) => UiMessage) =>
        setItems((list) => list.map((m) => (m.key === replyKey ? fn(m) : m)));
      setError(null);
      setBusy(true);
      setItems((list) => [
        ...list,
        { key: nextKey(), role: "user", content: message, citations: [], suggestions: [] },
        { key: replyKey, role: "assistant", content: "", citations: [], suggestions: [], status: "writing" },
      ]);
      const abort = new AbortController();
      abortRef.current = abort;
      let finished = false;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, threadId: threadId ?? undefined, ...context }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => null);
          throw new ApiClientError(res.status, data?.error?.code ?? "INTERNAL_ERROR", data?.error?.message ?? t.failed);
        }
        for await (const event of readEvents(res.body)) {
          switch (event.type) {
            case "thread":
              setThreadId(event.threadId);
              break;
            case "delta":
              patch((m) => ({ ...m, content: m.content + event.text, status: "writing" }));
              break;
            case "tool":
              patch((m) => ({ ...m, status: event.name === "search_site" ? "searching" : "working" }));
              break;
            case "citations":
              patch((m) => ({ ...m, citations: event.citations }));
              break;
            case "suggestion":
              patch((m) => ({ ...m, suggestions: [...m.suggestions, event.suggestion] }));
              break;
            case "done":
              finished = true;
              patch((m) => ({ ...m, content: event.content, citations: event.citations, status: undefined }));
              break;
            case "error":
              throw new ApiClientError(500, event.code, event.message);
          }
        }
        if (!finished) throw new ApiClientError(500, "INTERNAL_ERROR", t.failed);
      } catch (err) {
        const aborted = abort.signal.aborted;
        setError(aborted ? t.stopped : err instanceof ApiClientError ? err.message : t.failed);
        // 내용이 하나도 없는 답변 말풍선은 지운다
        setItems((list) =>
          list.flatMap((m) => (m.key !== replyKey ? [m] : m.content.trim() ? [{ ...m, status: undefined }] : [])),
        );
      } finally {
        if (abortRef.current === abort) abortRef.current = null;
        setBusy(false);
        void refreshThreads();
      }
    },
    [busy, threadId, refreshThreads, t.failed, t.stopped],
  );

  return { threadId, items, threads, busy, error, send, stop, newThread, openThread };
}
