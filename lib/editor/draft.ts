import type { DocContent } from "@/lib/editor/content";

/** 브라우저(IndexedDB)에 보관하는 로컬 초안 (SPEC 7.5) */
export type LocalDraft = {
  docId: string;
  title: string;
  contentJson: DocContent;
  /** 초안을 쓰기 시작한 시점의 서버 버전 */
  baseVersion: number;
  /** 로컬에 마지막으로 기록한 시각 (epoch ms) */
  savedAt: number;
};

type ServerDoc = { title: string; contentJson: DocContent; version: number };

/** 키 순서와 무관하게 JSON 값을 비교한다. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined);
  const ak = keys(ao);
  if (ak.length !== keys(bo).length) return false;
  return ak.every((k) => jsonEqual(ao[k], bo[k]));
}

export type DraftDecision =
  /** 초안이 없거나 서버와 같다 → 초안을 지운다 */
  | { action: "discard" }
  /** 서버에 없는 변경이 초안에 있다 → 복구를 제안한다. serverChanged면 그 사이 서버도 바뀐 것 */
  | { action: "offer"; serverChanged: boolean };

/** 문서를 열었을 때 로컬 초안을 어떻게 할지 결정한다. */
export function decideDraft(draft: LocalDraft | null, server: ServerDoc): DraftDecision {
  if (!draft) return { action: "discard" };
  if (draft.title === server.title && jsonEqual(draft.contentJson, server.contentJson)) return { action: "discard" };
  return { action: "offer", serverChanged: server.version !== draft.baseVersion };
}
