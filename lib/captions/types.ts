export const CAPTION_KINDS = ["figure", "table", "equation"] as const;
export type CaptionKind = (typeof CAPTION_KINDS)[number];

export function isCaptionKind(value: unknown): value is CaptionKind {
  return typeof value === "string" && (CAPTION_KINDS as readonly string[]).includes(value);
}

/** 캡션이 대상의 위에 오는지 아래에 오는지 */
export type CaptionPosition = "above" | "below";
export type CaptionPositions = Record<CaptionKind, CaptionPosition>;

/** 기본 규칙: 그림·수식은 아래, 표는 위. 서식 템플릿이 다른 값을 넘길 수 있다. */
export const DEFAULT_CAPTION_POSITIONS: CaptionPositions = { figure: "below", table: "above", equation: "below" };

export function captionPosition(kind: CaptionKind, positions: Partial<CaptionPositions> = {}): CaptionPosition {
  return positions[kind] ?? DEFAULT_CAPTION_POSITIONS[kind];
}

/** 캡션 종류별로 캡션이 붙는 대상 노드 이름 */
export const CAPTION_TARGET_NODE: Record<CaptionKind, string> = { figure: "image", table: "table", equation: "mathBlock" };

export function captionKindForNode(nodeType: string): CaptionKind | null {
  return CAPTION_KINDS.find((kind) => CAPTION_TARGET_NODE[kind] === nodeType) ?? null;
}

/** 번호를 매길 때 보는 항목. 문서 순서대로 나열한다. */
export type NumberingItem =
  | {
      type: "caption";
      kind: CaptionKind;
      id: string;
      text: string;
      /** 수식 캡션이 붙어 있는 블록 수식의 id */
      attachedTo?: string;
    }
  | { type: "mathBlock"; id: string; latex: string };

export type NumberedEntry = {
  /** 상호 참조가 가리킬 대표 id (수식은 블록 수식 id, 그 밖에는 캡션 id) */
  id: string;
  /** 같은 번호를 공유하는 모든 id (블록 수식 + 그 캡션) */
  ids: string[];
  kind: CaptionKind;
  number: number;
  /** 본문 참조에 쓰는 표시: `그림 1`, `표 1`, `식 (1)` */
  refLabel: string;
  /** 캡션 머리에 쓰는 표시: `그림 1.`, `표 1.`, `식 (1)` */
  captionLabel: string;
  /** 캡션 본문 (캡션 없는 수식은 빈 문자열) */
  text: string;
  /** 수식 항목이면 LaTeX 원문 */
  latex?: string;
};

export type Numbering = {
  entries: NumberedEntry[];
  byId: Map<string, NumberedEntry>;
};

export type KindLabels = Record<CaptionKind, string>;
