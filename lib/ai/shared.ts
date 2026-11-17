/**
 * 챗봇·AI 보조 기능에서 서버와 클라이언트가 함께 쓰는 타입.
 * 이 파일은 클라이언트 번들에 들어가도 되므로 서버 전용 코드를 import하지 않는다.
 */

/** 답변의 출처(사이트 내부 검색 결과). 익명 글 보호를 위해 작성자 정보는 담지 않는다. */
export type Citation = {
  kind: "research" | "pain";
  id: string;
  title: string;
  /** 사이트 내부 경로 (/research/:id, /pains/:id) */
  path: string;
};

export const CHART_TYPES = ["line", "scatter", "bar", "histogram", "box"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** 그래프 추천 한 건. AI는 유형·축 구성만 제안하고 수치는 만들지 않는다 (SPEC 7.3 e). */
export type ChartSuggestion = {
  chartType: ChartType;
  /** X축 열 이름 (히스토그램·상자그림은 null일 수 있다) */
  x: string | null;
  /** Y축 열 이름들 */
  y: string[];
  errorBar: string | null;
  logX: boolean;
  logY: boolean;
  trendline: boolean;
  xTitle: string;
  yTitle: string;
  reason: string;
};

/**
 * "삽입" 버튼을 눌렀을 때 에디터로 넘기는 내용.
 * 서버는 문서를 바꾸지 않는다. 사용자가 버튼을 눌러야만 반영된다 (SPEC 7.4).
 */
export type InsertPayload =
  | { kind: "text"; content: string; mode: "replace_selection" | "insert" }
  | { kind: "latex"; latex: string; display: "inline" | "block" }
  | { kind: "format"; rules: unknown }
  | { kind: "chart"; datasetId: string; suggestion: ChartSuggestion };

export type ChatSuggestion = { id: string; payload: InsertPayload };

/** POST /api/chat 의 SSE 이벤트 */
export type ChatEvent =
  | { type: "thread"; threadId: string; title: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "suggestion"; suggestion: ChatSuggestion }
  | { type: "done"; messageId: string; content: string; citations: Citation[] }
  | { type: "error"; code: string; message: string };

export type ChatMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
};

export type ChatThreadSummary = { id: string; title: string; createdAt: string };
