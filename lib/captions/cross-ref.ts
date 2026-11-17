import type { DocNode } from "@/lib/editor/content";
import { messages } from "@/lib/messages";
import { computeNumbering, DEFAULT_KIND_LABELS } from "./numbering";
import type { KindLabels, NumberedEntry, Numbering } from "./types";

export type ResolvedCrossRef = {
  targetId: string;
  /** 화면에 보일 글자. 대상이 없으면 깨진 참조 문구 */
  label: string;
  broken: boolean;
  entry: NumberedEntry | null;
};

export const BROKEN_REF_LABEL: string = messages.captions.brokenRef;

/** 참조 하나를 현재 번호로 푼다. 대상이 사라졌으면 깨진 참조. */
export function resolveCrossRef(numbering: Numbering, targetId: string, brokenLabel = BROKEN_REF_LABEL): ResolvedCrossRef {
  const entry = (targetId && numbering.byId.get(targetId)) || null;
  return entry
    ? { targetId, label: entry.refLabel, broken: false, entry }
    : { targetId, label: brokenLabel, broken: true, entry: null };
}

/** 문서 안의 상호 참조 대상 id를 문서 순서대로 모은다. */
export function collectCrossRefTargets(doc: DocNode): string[] {
  const out: string[] = [];
  const visit = (node: DocNode) => {
    if (node.type === "crossRef") out.push(typeof node.attrs?.targetId === "string" ? node.attrs.targetId : "");
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return out;
}

/** 문서의 모든 상호 참조를 현재 번호로 푼다. */
export function resolveCrossRefs(doc: DocNode, numbering: Numbering = computeNumbering(doc)): ResolvedCrossRef[] {
  return collectCrossRefTargets(doc).map((targetId) => resolveCrossRef(numbering, targetId));
}

/** 깨진 참조만 (서식 검사용) */
export function findBrokenCrossRefs(doc: DocNode, numbering: Numbering = computeNumbering(doc)): ResolvedCrossRef[] {
  return resolveCrossRefs(doc, numbering).filter((ref) => ref.broken);
}

export type RefTrigger = {
  /** `@` 뒤에 입력한 글자 */
  query: string;
  /** `@`의 위치 (넘겨받은 문자열 안에서의 인덱스) */
  start: number;
};

const MAX_QUERY = 30;

/**
 * 커서 앞 글자에서 `@그림` 같은 참조 입력을 찾는다.
 * `@`는 줄 처음이거나 공백·여는 괄호 뒤에 있어야 한다(이메일 주소 등은 제외).
 */
export function parseRefTrigger(textBefore: string): RefTrigger | null {
  const start = textBefore.lastIndexOf("@");
  if (start < 0) return null;
  const query = textBefore.slice(start + 1);
  if (query.length > MAX_QUERY || /[\s@]/.test(query)) return null;
  if (start > 0 && !/[\s([{"'“‘·,]/.test(textBefore[start - 1])) return null;
  return { query, start };
}

const compact = (s: string) => s.replace(/[\s().]/g, "").toLowerCase();

/** 입력이 종류 이름(그림/표/식)으로 시작하는지. 대상이 없을 때 안내를 띄울지 판단하는 데 쓴다. */
export function isKindQuery(query: string, labels: KindLabels = DEFAULT_KIND_LABELS): boolean {
  const q = compact(query);
  if (!q) return true;
  return Object.values(labels).some((label) => {
    const l = compact(label);
    return l.startsWith(q) || q.startsWith(l);
  });
}

/**
 * 참조 대상 고르기 목록. `그림` → 모든 그림, `그림2` → 그림 2(·20…), `표` → 모든 표,
 * 그 밖의 글자는 캡션 내용에서 찾는다. 빈 입력이면 전부.
 */
export function filterRefTargets(entries: NumberedEntry[], query: string): NumberedEntry[] {
  const q = compact(query);
  const targets = entries.filter((entry) => entry.id);
  if (!q) return targets;
  return targets.filter((entry) => {
    const label = compact(entry.refLabel);
    return label.startsWith(q) || q.startsWith(label) || compact(entry.text).includes(q);
  });
}
