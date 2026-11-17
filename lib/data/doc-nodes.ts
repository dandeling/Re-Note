import type { DocNode } from "@/lib/editor/content";

/**
 * 표·그래프를 문서에 넣을 때 쓰는 문서 JSON 조각 (docs/parallel-work.md "문서 노드 계약").
 * 순수 함수라 단위 테스트한다. 에디터에 넣는 얇은 함수는 components/data/insert.ts.
 */

export type CaptionKind = "figure" | "table";

/** 캡션 id. 문서 안에서만 유일하면 된다 (번호는 저장하지 않고 문서 순서로 계산). */
export function newCaptionId(kind: CaptionKind, random: () => number = Math.random) {
  return `${kind === "figure" ? "fig" : "tbl"}-${Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, "0")}`;
}

export function captionNode(kind: CaptionKind, id: string, text: string): DocNode {
  const t = text.trim();
  return { type: "caption", attrs: { kind, id }, ...(t ? { content: [{ type: "text", text: t }] } : {}) };
}

/** 그래프 이미지 노드. datasetId와 차트 설정을 attrs에 저장해 더블클릭 시 다시 편집한다. */
export function chartImageNode(input: { src: string; alt: string; datasetId: string; chart: unknown }): DocNode {
  return { type: "image", attrs: { src: input.src, alt: input.alt, datasetId: input.datasetId, chart: input.chart } };
}

/**
 * 삽입할 조각: 표는 캡션이 위, 그림은 캡션이 아래 (SPEC 7.3 (e)).
 * 에디터 스키마에 caption 노드가 없으면 캡션 없이 본체만 넣는다.
 */
export function withCaption(body: DocNode, caption: { kind: CaptionKind; id: string; text: string } | null): DocNode[] {
  if (!caption) return [body];
  const c = captionNode(caption.kind, caption.id, caption.text);
  return caption.kind === "table" ? [c, body] : [body, c];
}
