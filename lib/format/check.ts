import type { DocContent, DocNode } from "@/lib/editor/content";
import { FONTS, resolveFont, type FontId } from "@/lib/format/fonts";
import { captionKindOf, computeNumbering, numberLabel, type CaptionKind } from "@/lib/format/numbering";
import type { FormatRules, HeadingLevel } from "@/lib/format/rules";

/**
 * 서식 검사 (SPEC 7.3 (d)): 규칙에서 벗어난 부분을 찾고, 고칠 수 있는 것은 "모두 고치기"로 고친다.
 * 문서 JSON(Tiptap)만 다루는 순수 함수다. 캡션·상호 참조·수식 노드는 docs/parallel-work.md의 "문서 노드 계약"을 따른다.
 */
export type FormatIssueCode =
  | "font-mismatch"
  | "size-mismatch"
  | "heading-align"
  | "heading-skip"
  | "caption-missing"
  | "caption-position"
  | "caption-orphan"
  | "number-mismatch"
  | "number-duplicate"
  | "duplicate-id"
  | "broken-ref";

export type FormatIssue = {
  code: FormatIssueCode;
  /** 문제가 있는 최상위 블록의 순서 (0부터) */
  block: number;
  /** 화면 문구에 채울 값 */
  params: Record<string, string>;
  /** "모두 고치기"로 고칠 수 있는지 */
  fixable: boolean;
};

export type FormatCheckOptions = {
  /** 에디터 스키마에 caption 노드가 있어 캡션을 새로 넣을 수 있는지 (없으면 캡션 누락은 직접 고쳐야 한다) */
  canInsertCaption?: boolean;
  /** 새 캡션·중복 id에 줄 식별자 (테스트에서 고정값을 넣는다) */
  newId?: () => string;
};

const KIND_OF_NODE: Record<string, CaptionKind> = { image: "figure", table: "table" };
const SNIPPET = 30;

function textOf(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(textOf).join("");
}

function snippet(node: DocNode): string {
  const text = textOf(node).replace(/\s+/g, " ").trim();
  return text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text;
}

/** 캡션 앞에 사용자가 직접 쓴 번호: "그림 3.", "표 2:", "식 (4)", "[그림 1]" 등 */
const WRITTEN_NUMBER = /^\s*\[?\s*(그림|표|식|Figure|Fig\.?|Table|Eq\.?)\s*\(?\s*(\d+)\s*\)?\s*\]?\s*[.:)\-–]?\s*/i;
const KIND_WORDS: Record<string, CaptionKind> = { 그림: "figure", figure: "figure", fig: "figure", "fig.": "figure", 표: "table", table: "table", 식: "equation", eq: "equation", "eq.": "equation" };

function writtenNumber(caption: DocNode): { match: string; kind: CaptionKind; number: number } | null {
  const first = caption.content?.[0];
  if (first?.type !== "text" || !first.text) return null;
  const m = WRITTEN_NUMBER.exec(first.text);
  if (!m) return null;
  return { match: m[0], kind: KIND_WORDS[m[1].toLowerCase()] ?? "figure", number: Number(m[2]) };
}

function stripWrittenNumber(caption: DocNode, match: string) {
  const first = caption.content![0];
  const rest = first.text!.slice(match.length);
  if (rest) first.text = rest;
  else caption.content = caption.content!.slice(1);
  if (caption.content!.length === 0) delete caption.content;
}

/** "12pt", "16px", "1.2em"(본문 기준) → pt. 해석할 수 없으면 null */
export function toPt(value: unknown, basePt: number): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const m = /^\s*([\d.]+)\s*(pt|px|em|rem|%)?\s*$/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  switch ((m[2] ?? "px").toLowerCase()) {
    case "pt":
      return n;
    case "px":
      return n * 0.75;
    case "%":
      return (basePt * n) / 100;
    default:
      return basePt * n;
  }
}

/** CSS font-family 값의 첫 글꼴이 규칙의 글꼴과 같은 글꼴인지 */
function sameFont(value: string, expected: FontId): boolean {
  const first = value.split(",")[0].replace(/["']/g, "").trim();
  if (!first) return true;
  const resolved = resolveFont(first);
  return !resolved.substituted && resolved.font === expected;
}

type Ctx = {
  rules: FormatRules;
  fix: boolean;
  canInsertCaption: boolean;
  newId: () => string;
  issues: FormatIssue[];
  block: number;
};

function push(ctx: Ctx, code: FormatIssueCode, params: Record<string, string>, fixable: boolean) {
  ctx.issues.push({ code, block: ctx.block, params, fixable });
}

/** 블록 안 글자의 글꼴·크기 표시(textStyle)를 검사한다. 고치면 그 표시를 지워 규칙 값을 따르게 한다. */
function checkTextStyle(ctx: Ctx, block: DocNode, font: FontId, sizePt: number) {
  let fontBad = false;
  let sizeBad = false;
  const visit = (node: DocNode) => {
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type !== "textStyle" || !mark.attrs) continue;
        const { fontFamily, fontSize } = mark.attrs;
        if (typeof fontFamily === "string" && fontFamily.trim() && !sameFont(fontFamily, font)) {
          fontBad = true;
          if (ctx.fix) mark.attrs.fontFamily = null;
        }
        const pt = fontSize === null || fontSize === undefined || fontSize === "" ? null : toPt(fontSize, sizePt);
        if (pt !== null && Math.abs(pt - sizePt) > 0.25) {
          sizeBad = true;
          if (ctx.fix) mark.attrs.fontSize = null;
        }
      }
      if (ctx.fix) {
        node.marks = node.marks.filter(
          (m) => m.type !== "textStyle" || Object.values(m.attrs ?? {}).some((v) => v !== null && v !== undefined && v !== ""),
        );
        if (node.marks.length === 0) delete node.marks;
      }
    }
    node.content?.forEach(visit);
  };
  visit(block);
  const text = snippet(block);
  if (fontBad) push(ctx, "font-mismatch", { text, expected: FONTS[font].label }, true);
  if (sizeBad) push(ctx, "size-mismatch", { text, expected: `${sizePt}pt` }, true);
}

function headingLevel(node: DocNode): number {
  const level = Number(node.attrs?.level ?? 1);
  return Number.isFinite(level) ? Math.min(Math.max(Math.round(level), 1), 4) : 1;
}

/** 형제 목록에서 그림·표와 캡션의 짝을 검사한다. 고치면 캡션을 넣거나 옮긴 새 목록을 돌려준다. */
function checkCaptions(ctx: Ctx, children: DocNode[], blockOf: (i: number) => number): DocNode[] {
  const attached = new Set<DocNode>();
  const insertAfter = new Map<DocNode, DocNode>();
  const insertBefore = new Map<DocNode, DocNode>();
  const removed = new Set<DocNode>();

  children.forEach((node, i) => {
    const kind = KIND_OF_NODE[node.type];
    if (!kind) {
      if (node.type === "mathBlock") {
        for (const side of [children[i - 1], children[i + 1]]) if (side && captionKindOf(side) === "equation") attached.add(side);
      }
      return;
    }
    ctx.block = blockOf(i);
    const position = kind === "figure" ? ctx.rules.caption.figurePosition : ctx.rules.caption.tablePosition;
    const prev = children[i - 1];
    const next = children[i + 1];
    const isMine = (n: DocNode | undefined) => !!n && captionKindOf(n) === kind && !attached.has(n);
    const expected = position === "above" ? prev : next;
    const other = position === "above" ? next : prev;
    if (isMine(expected)) {
      attached.add(expected!);
      return;
    }
    // 위 캡션 규칙에서 아래쪽 캡션은 바로 다음 그림·표의 제자리 캡션일 수 있다.
    const otherBelongsToNeighbor =
      !isMine(other) || (position === "above" && KIND_OF_NODE[children[i + 2]?.type ?? ""] === kind);
    if (!otherBelongsToNeighbor) {
      attached.add(other!);
      push(ctx, "caption-position", { kind, expected: position }, true);
      if (ctx.fix) {
        removed.add(other!);
        (position === "above" ? insertBefore : insertAfter).set(node, other!);
      }
      return;
    }
    push(ctx, "caption-missing", { kind }, ctx.canInsertCaption);
    if (ctx.fix && ctx.canInsertCaption) {
      const caption: DocNode = { type: "caption", attrs: { kind, id: ctx.newId() } };
      (position === "above" ? insertBefore : insertAfter).set(node, caption);
    }
  });

  children.forEach((node, i) => {
    const kind = captionKindOf(node);
    if (!kind || attached.has(node)) return;
    ctx.block = blockOf(i);
    push(ctx, "caption-orphan", { kind, text: snippet(node) }, false);
  });

  if (!ctx.fix || (insertAfter.size === 0 && insertBefore.size === 0)) return children;
  const out: DocNode[] = [];
  for (const node of children) {
    if (removed.has(node)) continue;
    const before = insertBefore.get(node);
    if (before) out.push(before);
    out.push(node);
    const after = insertAfter.get(node);
    if (after) out.push(after);
  }
  return out;
}

function walk(ctx: Ctx, parent: DocNode, top: boolean) {
  const children = parent.content;
  if (!children) return;
  const blockOf = (i: number) => (top ? i : ctx.block);
  const topBlock = ctx.block;
  children.forEach((node, i) => {
    ctx.block = top ? i : topBlock;
    if (node.type === "heading") {
      const h = `h${headingLevel(node)}` as HeadingLevel;
      const style = ctx.rules.headings[h];
      const align = node.attrs?.textAlign;
      if (typeof align === "string" && align && align !== style.align) {
        push(ctx, "heading-align", { text: snippet(node), expected: style.align }, true);
        if (ctx.fix) node.attrs = { ...node.attrs, textAlign: null };
      }
      checkTextStyle(ctx, node, style.font, style.sizePt);
      return;
    }
    if (node.type === "caption") {
      checkTextStyle(ctx, node, ctx.rules.body.font, ctx.rules.caption.sizePt);
      return;
    }
    if (node.type === "paragraph") {
      checkTextStyle(ctx, node, ctx.rules.body.font, ctx.rules.body.sizePt);
      return;
    }
    walk(ctx, node, false);
  });
  ctx.block = topBlock;
  const next = checkCaptions(ctx, children, blockOf);
  if (next !== children) parent.content = next;
}

/** 제목 단계 건너뜀 (제목 1 다음에 바로 제목 3). 고치면 앞 제목보다 한 단계 아래로 맞춘다. */
function checkHeadingOrder(ctx: Ctx, doc: DocNode) {
  let prev = 0;
  (doc.content ?? []).forEach((node, i) => {
    if (node.type !== "heading") return;
    const level = headingLevel(node);
    if (prev > 0 && level > prev + 1) {
      ctx.block = i;
      push(ctx, "heading-skip", { from: String(prev), to: String(level), text: snippet(node) }, true);
      if (ctx.fix) {
        node.attrs = { ...node.attrs, level: prev + 1 };
        prev += 1;
        return;
      }
    }
    prev = level;
  });
}

/** 캡션 번호·식별자·상호 참조 */
function checkNumbering(ctx: Ctx, doc: DocNode) {
  // 같은 id를 쓰는 캡션·블록 수식
  const seen = new Set<string>();
  const forEachTop = (fn: (node: DocNode) => void) =>
    (doc.content ?? []).forEach((top, i) => {
      ctx.block = i;
      const visit = (n: DocNode) => {
        fn(n);
        n.content?.forEach(visit);
      };
      visit(top);
    });
  forEachTop((node) => {
    if (node.type !== "caption" && node.type !== "mathBlock") return;
    const id = node.attrs?.id;
    if (typeof id !== "string" || !id) return;
    if (!seen.has(id)) {
      seen.add(id);
      return;
    }
    // 옆 수식과 한 쌍인 수식 캡션이 같은 id를 쓰는 것은 정상이 아니지만 번호는 같으므로 그대로 둔다.
    push(ctx, "duplicate-id", { kind: node.type === "mathBlock" ? "equation" : (captionKindOf(node) ?? "figure") }, true);
    if (ctx.fix) {
      let fresh = ctx.newId();
      while (seen.has(fresh)) fresh = ctx.newId();
      node.attrs = { ...node.attrs, id: fresh };
      seen.add(fresh);
    }
  });

  const numbering = computeNumbering(doc);
  forEachTop((node) => {
    if (node.type !== "caption") return;
    const written = writtenNumber(node);
    const auto = numbering.byNode.get(node);
    if (!written || !auto) return;
    const expected = numberLabel(auto);
    const same = written.kind === auto.kind && written.number === auto.number;
    push(ctx, same ? "number-duplicate" : "number-mismatch", { written: written.match.trim(), expected }, true);
    if (ctx.fix) stripWrittenNumber(node, written.match);
  });

  forEachTop((node) => {
    if (node.type !== "crossRef") return;
    const target = node.attrs?.targetId;
    if (typeof target === "string" && numbering.byId.has(target)) return;
    push(ctx, "broken-ref", {}, false);
  });
}

function run(doc: DocNode, rules: FormatRules, opts: FormatCheckOptions, fix: boolean): FormatIssue[] {
  const ctx: Ctx = {
    rules,
    fix,
    canInsertCaption: opts.canInsertCaption ?? true,
    newId: opts.newId ?? (() => `c${Math.random().toString(36).slice(2, 10)}`),
    issues: [],
    block: 0,
  };
  // 번호·id 검사를 먼저 한다: 캡션을 넣거나 옮기기 전의 문서 순서 기준으로 보고하기 위해.
  checkNumbering(ctx, doc);
  checkHeadingOrder(ctx, doc);
  walk(ctx, doc, true);
  return ctx.issues.sort((a, b) => a.block - b.block);
}

/** 규칙에서 벗어난 부분 목록 (문서는 바꾸지 않는다) */
export function checkFormat(doc: DocContent, rules: FormatRules, opts: FormatCheckOptions = {}): FormatIssue[] {
  return run(structuredClone(doc), rules, opts, false);
}

/** "모두 고치기": 고칠 수 있는 것을 고친 새 문서와 고친 개수. 직접 고쳐야 하는 것은 그대로 남는다. */
export function fixFormat(
  doc: DocContent,
  rules: FormatRules,
  opts: FormatCheckOptions = {},
): { doc: DocContent; fixed: number; remaining: FormatIssue[] } {
  const next = structuredClone(doc);
  const issues = run(next, rules, opts, true);
  return { doc: next, fixed: issues.filter((i) => i.fixable).length, remaining: checkFormat(next, rules, opts) };
}
