import type { DocNode } from "@/lib/editor/content";

/**
 * 캡션·수식 번호 계산 (docs/parallel-work.md "문서 노드 계약").
 * 번호는 문서에 저장하지 않고 문서 순서로 계산한다. 서식 검사와 내보내기가 같이 쓴다. 순수 함수.
 */
export type CaptionKind = "figure" | "table" | "equation";
export const CAPTION_KINDS: readonly CaptionKind[] = ["figure", "table", "equation"];

export function captionKindOf(node: DocNode): CaptionKind | null {
  if (node.type !== "caption") return null;
  const kind = node.attrs?.kind;
  return CAPTION_KINDS.includes(kind as CaptionKind) ? (kind as CaptionKind) : "figure";
}

export type Numbered = { kind: CaptionKind; number: number };

export type Numbering = {
  /** 캡션·블록 수식 노드 → 번호 */
  byNode: Map<DocNode, Numbered>;
  /** id → 번호 (상호 참조가 가리키는 대상) */
  byId: Map<string, Numbered>;
};

/** `그림 1`, `표 2`, `식 (3)` (SPEC 7.3 (b)) */
export function numberLabel({ kind, number }: Numbered): string {
  if (kind === "figure") return `그림 ${number}`;
  if (kind === "table") return `표 ${number}`;
  return `식 (${number})`;
}

export function computeNumbering(doc: DocNode): Numbering {
  const byNode = new Map<DocNode, Numbered>();
  const byId = new Map<string, Numbered>();
  const counters: Record<CaptionKind, number> = { figure: 0, table: 0, equation: 0 };

  const assign = (node: DocNode, numbered: Numbered) => {
    byNode.set(node, numbered);
    const id = node.attrs?.id;
    if (typeof id === "string" && id && !byId.has(id)) byId.set(id, numbered);
  };
  const next = (kind: CaptionKind): Numbered => ({ kind, number: (counters[kind] += 1) });

  const walk = (children: DocNode[]) => {
    children.forEach((node, i) => {
      if (node.type === "mathBlock") {
        if (!byNode.has(node)) assign(node, next("equation"));
        return;
      }
      const kind = captionKindOf(node);
      if (kind === "equation") {
        // 수식 캡션은 바로 옆 블록 수식과 번호를 같이 쓴다. 옆에 수식이 없으면 따로 번호를 받는다.
        const prev = children[i - 1];
        const following = children[i + 1];
        if (prev?.type === "mathBlock" && byNode.has(prev)) assign(node, byNode.get(prev)!);
        else if (following?.type === "mathBlock") {
          const numbered = next("equation");
          assign(following, numbered);
          assign(node, numbered);
        } else assign(node, next("equation"));
        return;
      }
      if (kind) {
        assign(node, next(kind));
        return;
      }
      if (node.content) walk(node.content);
    });
  };
  walk(doc.content ?? []);
  return { byNode, byId };
}
