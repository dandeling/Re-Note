import type { DocNode } from "@/lib/editor/content";
import { messages } from "@/lib/messages";
import {
  CAPTION_TARGET_NODE,
  isCaptionKind,
  type CaptionKind,
  type KindLabels,
  type NumberedEntry,
  type Numbering,
  type NumberingItem,
} from "./types";

export const DEFAULT_KIND_LABELS: KindLabels = messages.captions.kinds;

/** 본문 참조 표시: `그림 1`, `표 1`, `식 (1)` */
export function formatRefLabel(kind: CaptionKind, number: number, labels: KindLabels = DEFAULT_KIND_LABELS): string {
  return kind === "equation" ? `${labels.equation} (${number})` : `${labels[kind]} ${number}`;
}

/** 캡션 머리 표시: `그림 1.`, `표 1.`, `식 (1)` */
export function formatCaptionLabel(kind: CaptionKind, number: number, labels: KindLabels = DEFAULT_KIND_LABELS): string {
  return kind === "equation" ? formatRefLabel(kind, number, labels) : `${formatRefLabel(kind, number, labels)}.`;
}

/** 블록 수식 오른쪽에 붙는 번호: `(1)` */
export function formatEquationTag(number: number): string {
  return `(${number})`;
}

function nodeText(node: DocNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type Sibling = { type: string; id: string } | null;

/**
 * 수식 캡션이 어느 블록 수식에 붙는지: 바로 앞 형제가 블록 수식이면 그것,
 * 아니면 바로 뒤 형제가 블록 수식일 때 그것. (에디터의 PM 문서 수집기도 같은 규칙을 쓴다.)
 */
export function attachedMathBlockId(prev: Sibling, next: Sibling): string | undefined {
  if (prev?.type === CAPTION_TARGET_NODE.equation && prev.id) return prev.id;
  if (next?.type === CAPTION_TARGET_NODE.equation && next.id) return next.id;
  return undefined;
}

/** 문서 JSON에서 번호 대상(캡션, 블록 수식)을 문서 순서대로 모은다. */
export function collectNumberingItems(doc: DocNode): NumberingItem[] {
  const items: NumberingItem[] = [];
  const brief = (n: DocNode | undefined): Sibling => (n ? { type: n.type, id: str(n.attrs?.id) } : null);
  const visit = (node: DocNode) => {
    const children = node.content ?? [];
    children.forEach((child, i) => {
      if (child.type === "caption") {
        const rawKind = child.attrs?.kind;
        const kind = isCaptionKind(rawKind) ? rawKind : "figure";
        const item: NumberingItem = { type: "caption", kind, id: str(child.attrs?.id), text: nodeText(child) };
        if (kind === "equation") {
          const attachedTo = attachedMathBlockId(brief(children[i - 1]), brief(children[i + 1]));
          if (attachedTo) item.attachedTo = attachedTo;
        }
        items.push(item);
      } else if (child.type === "mathBlock") {
        items.push({ type: "mathBlock", id: str(child.attrs?.id), latex: str(child.attrs?.latex) });
      } else {
        visit(child);
      }
    });
  };
  visit(doc);
  return items;
}

/**
 * 번호 부여. 종류별로 문서 순서대로 1부터 센다.
 * - 그림·표: 캡션 하나가 번호 하나.
 * - 수식: 블록 수식 하나가 번호 하나. 블록 수식에 붙은 수식 캡션은 그 수식의 번호를 함께 쓴다.
 *   어디에도 붙지 않은 수식 캡션은 자기 번호를 받는다.
 */
export function numberItems(items: NumberingItem[], labels: KindLabels = DEFAULT_KIND_LABELS): Numbering {
  const counters: Record<CaptionKind, number> = { figure: 0, table: 0, equation: 0 };
  const entries: NumberedEntry[] = [];
  const byId = new Map<string, NumberedEntry>();
  const mathEntries = new Map<string, NumberedEntry>();
  const captioned = new Set<NumberedEntry>();
  // 수식 캡션이 수식보다 앞에 올 수도 있다(위쪽 캡션). 그때는 수식이 나올 때까지 기다린다.
  const mathIds = new Set<string>();
  for (const item of items) if (item.type === "mathBlock" && item.id) mathIds.add(item.id);
  const waiting = new Map<string, { id: string; text: string }>();

  const add = (kind: CaptionKind, id: string, text: string, latex?: string) => {
    const number = ++counters[kind];
    const entry: NumberedEntry = {
      id,
      ids: id ? [id] : [],
      kind,
      number,
      refLabel: formatRefLabel(kind, number, labels),
      captionLabel: formatCaptionLabel(kind, number, labels),
      text,
    };
    if (latex !== undefined) entry.latex = latex;
    entries.push(entry);
    if (id && !byId.has(id)) byId.set(id, entry);
    return entry;
  };

  const attach = (entry: NumberedEntry, captionId: string, text: string) => {
    captioned.add(entry);
    entry.text = text;
    if (captionId && !byId.has(captionId)) {
      entry.ids.push(captionId);
      byId.set(captionId, entry);
    }
  };

  for (const item of items) {
    if (item.type === "mathBlock") {
      const first = !!item.id && !mathEntries.has(item.id);
      const entry = add("equation", item.id, "", item.latex);
      if (first) {
        mathEntries.set(item.id, entry);
        const pending = waiting.get(item.id);
        if (pending) {
          waiting.delete(item.id);
          attach(entry, pending.id, pending.text);
        }
      }
      continue;
    }
    if (item.kind === "equation" && item.attachedTo && mathIds.has(item.attachedTo)) {
      const target = mathEntries.get(item.attachedTo);
      if (target && !captioned.has(target)) {
        attach(target, item.id, item.text);
        continue;
      }
      if (!target && !waiting.has(item.attachedTo)) {
        waiting.set(item.attachedTo, { id: item.id, text: item.text });
        continue;
      }
    }
    add(item.kind, item.id, item.text);
  }

  return { entries, byId };
}

/** 문서 JSON 전체의 번호를 계산한다. */
export function computeNumbering(doc: DocNode, labels: KindLabels = DEFAULT_KIND_LABELS): Numbering {
  return numberItems(collectNumberingItems(doc), labels);
}
