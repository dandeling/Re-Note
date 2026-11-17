/**
 * 서식 폼 채우기 (SPEC 7.3 (d): 자유 텍스트 → AI가 rulesJson으로 변환 → 사용자 확인 후 적용).
 * AI 변환 쪽(챗봇 등)은 변환 결과를 이 함수로 넘기기만 하면 된다.
 * 에디터의 서식 패널이 열리고 폼에 값이 채워지며, 사용자가 저장해야 문서에 적용된다.
 * 일부만 채운 규칙이나 제공하지 않는 글꼴 이름이 들어와도 된다(`normalizeRules`가 정리하고 대체 글꼴을 알린다).
 */
export const FORMAT_FILL_EVENT = "researchmate:format-fill";

export function requestFormatFill(rulesJson: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FORMAT_FILL_EVENT, { detail: rulesJson }));
}
