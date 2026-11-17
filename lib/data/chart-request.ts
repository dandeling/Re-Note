import type { ChartSuggestion } from "@/lib/ai/shared";

/**
 * 그래프 추천으로 "그래프 만들기" 열기 (SPEC 7.3 (e)·7.4).
 * 챗봇의 그래프 추천에서 "삽입"을 누르면 이 이벤트로 데이터 도구의 그래프 만들기를 그 추천 설정으로 연다.
 * 실제 그리기·삽입은 사용자가 그래프 만들기 화면에서 확인한 뒤 원본 데이터로 한다.
 */
export const CHART_SUGGESTION_EVENT = "researchmate:chart-suggestion";

export type ChartSuggestionRequest = { datasetId: string; suggestion: ChartSuggestion };

export function requestChartFromSuggestion(request: ChartSuggestionRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChartSuggestionRequest>(CHART_SUGGESTION_EVENT, { detail: request }));
}
