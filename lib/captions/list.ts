import type { DocNode } from "@/lib/editor/content";
import { messages } from "@/lib/messages";
import { resolveCrossRef } from "./cross-ref";
import { computeNumbering } from "./numbering";
import { isCaptionKind, type CaptionKind, type Numbering } from "./types";

export type CaptionListEntry = {
  id: string;
  number: number;
  /** `그림 1.` */
  label: string;
  /** 캡션 본문 */
  text: string;
};

/** "그림 목차" / "표 목차"에 들어갈 항목 (문서 순서) */
export function buildCaptionList(numbering: Numbering, kind: CaptionKind): CaptionListEntry[] {
  return numbering.entries
    .filter((entry) => entry.kind === kind)
    .map((entry) => ({ id: entry.id, number: entry.number, label: entry.captionLabel, text: entry.text.trim() }));
}

export function captionListTitle(kind: CaptionKind): string {
  return messages.captions.listTitles[kind];
}

/** 목차 한 줄: `그림 1. 실험 장치` */
export function captionListLine(entry: CaptionListEntry): string {
  return entry.text ? `${entry.label} ${entry.text}` : entry.label;
}

/**
 * 내보내기용: 번호를 글자로 굳힌 문서 사본을 만든다. 원본은 바꾸지 않는다.
 * - `caption`: 내용 앞에 `그림 1. ` 글자를 붙인다.
 * - `crossRef`: `그림 1` 글자(text 노드)로 바꾼다. 깨진 참조는 깨진 참조 문구.
 * - `captionList`: 제목 문단 + 항목마다 문단으로 펼친다.
 * - `mathBlock`: 그대로 둔다 (번호는 `computeNumbering(doc).byId.get(id)`로 얻는다).
 * 저장용 문서에는 쓰지 않는다 (번호는 문서 JSON에 저장하지 않는다).
 */
export function materializeNumbering(doc: DocNode, numbering: Numbering = computeNumbering(doc)): DocNode {
  const mapNode = (node: DocNode): DocNode[] => {
    if (node.type === "crossRef") {
      const targetId = typeof node.attrs?.targetId === "string" ? node.attrs.targetId : "";
      const text: DocNode = { type: "text", text: resolveCrossRef(numbering, targetId).label };
      if (node.marks) text.marks = node.marks;
      return [text];
    }
    if (node.type === "captionList") {
      const kind = isCaptionKind(node.attrs?.kind) ? node.attrs.kind : "figure";
      const entries = buildCaptionList(numbering, kind);
      const lines = entries.length ? entries.map(captionListLine) : [messages.captions.listEmpty];
      return [
        { type: "paragraph", content: [{ type: "text", text: captionListTitle(kind), marks: [{ type: "bold" }] }] },
        ...lines.map((line): DocNode => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
      ];
    }
    const next: DocNode = { ...node };
    if (node.content) next.content = node.content.flatMap(mapNode);
    if (node.type === "caption") {
      const entry = typeof node.attrs?.id === "string" ? numbering.byId.get(node.attrs.id) : undefined;
      if (entry) next.content = [{ type: "text", text: `${entry.captionLabel} ` }, ...(next.content ?? [])];
    }
    return [next];
  };
  return mapNode(doc)[0];
}
