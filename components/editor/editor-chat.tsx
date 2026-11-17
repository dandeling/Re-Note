"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useRef } from "react";
import { ChatPanel } from "@/components/chat/chat-panel";
import type { InsertPayload } from "@/lib/ai/shared";
import { requestChartFromSuggestion } from "@/lib/data/chart-request";
import { captureSelection, insertSuggestedLatex, insertSuggestedText, type CapturedSelection } from "@/lib/editor/ai-insert";
import { requestFormatFill } from "@/lib/format/fill";

/** 프로젝트 설명·데이터셋 컨텍스트는 서버가 문서의 프로젝트에서 읽는다. */
type Props = { editor: Editor | null; documentId: string };

/**
 * 에디터 우측 패널의 AI 도우미 (SPEC 5장·7.4).
 * 질문을 보낼 때 선택 영역을 컨텍스트로 보내고, 제안은 사용자가 "삽입"을 눌렀을 때만 문서·폼에 반영한다.
 */
export function EditorChat({ editor, documentId }: Props) {
  const captured = useRef<CapturedSelection | undefined>(undefined);

  const getSelection = useCallback(() => {
    captured.current = editor ? captureSelection(editor) : undefined;
    return captured.current?.text;
  }, [editor]);

  const onInsert = useCallback(
    (payload: InsertPayload) => {
      switch (payload.kind) {
        case "text":
          if (editor) insertSuggestedText(editor, payload.content, payload.mode, captured.current);
          return;
        case "latex":
          if (editor) insertSuggestedLatex(editor, payload.latex, payload.display);
          return;
        case "format":
          // 서식 폼에 채우기만 한다. 적용(저장)은 사용자가 폼을 확인한 뒤 한다.
          requestFormatFill(payload.rules);
          return;
        case "chart":
          // 그래프 만들기를 추천 설정으로 연다. 그리기·삽입은 사용자가 그 화면에서 한다.
          requestChartFromSuggestion({ datasetId: payload.datasetId, suggestion: payload.suggestion });
          return;
      }
    },
    [editor],
  );

  return (
    <ChatPanel
      documentId={documentId}
      getSelection={getSelection}
      onInsert={editor ? onInsert : undefined}
    />
  );
}
