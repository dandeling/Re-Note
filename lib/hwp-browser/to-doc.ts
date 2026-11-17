import { MAX_CONTENT_BYTES, type DocContent, type DocNode } from "@/lib/editor/content";
import type { Block, ImageBlock, TableBlock } from "./types";

/**
 * 파서 블록 → 이 앱의 문서 형식(Tiptap JSON). 서버 가져오기(lib/importer/html-to-doc.ts)가 만드는 것과 같은 노드만 쓴다:
 * heading(1~4), paragraph(+hardBreak), table/tableRow/tableCell(colspan·rowspan·colwidth), image(src·alt·title).
 * 수식 글자 "[수식: …]"은 code 마크로 구분한다.
 */

export type BlocksToDocOptions = {
  /** 그림 블록 → 문서에 넣을 URL(/api/assets/:id). null이면 그 자리에 안내 문단을 남긴다. 없으면 모든 그림이 안내 문단. */
  imageUrl?: (img: ImageBlock) => string | null;
  /** 문서 JSON의 UTF-8 바이트 한도(요청 본문 한도에 맞출 때). 문자 수 한도(MAX_CONTENT_BYTES)는 늘 지킨다. */
  maxBytes?: number;
};

export type BlocksToDocResult = {
  doc: DocContent;
  stats: { paragraphs: number; headings: number; tables: number; images: number; imagePlaceholders: number };
  /** 문서 크기 제한(5MB)을 넘어 뒤쪽 블록을 잘라 냈다 */
  truncated: boolean;
};

const EQUATION = /\[수식: [^\n]*?\]/g;

export function imagePlaceholderText(n: number) {
  return `[그림 ${n}: 그림을 올리지 못해 넣지 못했어요. 원본 파일에서 확인해 주세요.]`;
}

/** 한 줄 글자 → text 노드들(수식은 code 마크) */
function inlineText(line: string): DocNode[] {
  const out: DocNode[] = [];
  let last = 0;
  for (const m of line.matchAll(EQUATION)) {
    if (m.index > last) out.push({ type: "text", text: line.slice(last, m.index) });
    out.push({ type: "text", text: m[0], marks: [{ type: "code" }] });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ type: "text", text: line.slice(last) });
  return out.filter((n) => n.text);
}

/** 여러 줄 글자 → 인라인 노드(줄바꿈은 hardBreak). 탭은 공백으로. */
function inline(text: string): DocNode[] {
  const lines = text.replace(/\t/g, " ").split("\n");
  const out: DocNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: "hardBreak" });
    out.push(...inlineText(line));
  });
  while (out[0]?.type === "hardBreak") out.shift();
  while (out.at(-1)?.type === "hardBreak") out.pop();
  return out;
}

const paragraph = (text: string): DocNode => {
  const content = inline(text);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

/**
 * 표 → table 노드. 빈 자리(셀 주소가 건너뛴 칸)는 빈 칸으로 채우고, 병합 칸에 완전히 가려진 행은 빼고 rowspan을 줄인다
 * (ProseMirror 표가 어긋나지 않게).
 */
function table(t: TableBlock): DocNode | null {
  if (!t.rows || !t.cols || !t.cells.length) return null;
  type Cell = { row: number; col: number; rowSpan: number; colSpan: number; text: string };
  const cells: Cell[] = t.cells.map((c) => ({ ...c }));
  const owner: (Cell | null)[][] = Array.from({ length: t.rows }, () => Array<Cell | null>(t.cols).fill(null));
  for (const c of cells) {
    for (let r = c.row; r < c.row + c.rowSpan && r < t.rows; r++) {
      for (let k = c.col; k < c.col + c.colSpan && k < t.cols; k++) if (!owner[r][k]) owner[r][k] = c;
    }
  }
  // 겹친 병합은 첫 칸이 이긴다: 각 칸의 span을 실제로 차지한 범위 안으로 줄인다
  for (const c of cells) {
    if (owner[c.row]?.[c.col] !== c) continue;
    let cs = 1;
    while (cs < c.colSpan && c.col + cs < t.cols && owner[c.row][c.col + cs] === c) cs++;
    let rs = 1;
    while (rs < c.rowSpan && c.row + rs < t.rows && owner[c.row + rs][c.col] === c) rs++;
    c.colSpan = cs;
    c.rowSpan = rs;
  }
  const rows: DocNode[] = [];
  const keptRows: number[] = [];
  const origins = (r: number) => cells.filter((c) => c.row === r && owner[r][c.col] === c);
  for (let r = 0; r < t.rows; r++) {
    const hasOrigin = origins(r).length > 0;
    const hasGap = owner[r].some((o) => o === null);
    if (hasOrigin || hasGap) keptRows.push(r);
  }
  const kept = new Set(keptRows);
  for (const r of keptRows) {
    const row: DocNode[] = [];
    for (let k = 0; k < t.cols; k++) {
      const o = owner[r][k];
      if (o === null) {
        row.push({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph" }] });
        continue;
      }
      if (o.row !== r || o.col !== k) continue;
      let rowspan = 0;
      for (let rr = o.row; rr < o.row + o.rowSpan; rr++) if (kept.has(rr)) rowspan++;
      const content = o.text.split("\n").filter((line, i, all) => line.trim() || all.length === 1).map(paragraph);
      row.push({
        type: "tableCell",
        attrs: { colspan: Math.min(50, o.colSpan), rowspan: Math.min(500, Math.max(1, rowspan)), colwidth: null },
        content: content.length ? content : [{ type: "paragraph" }],
      });
    }
    if (row.length) rows.push({ type: "tableRow", content: row });
  }
  return rows.length ? { type: "table", content: rows } : null;
}

/** 직렬화 크기가 문서 한도를 넘으면 뒤쪽 블록부터 잘라 낸다 */
function fitToLimit(content: DocNode[], maxBytes = Infinity): { content: DocNode[]; truncated: boolean } {
  const blocks = [...content];
  const encoder = new TextEncoder();
  const tooBig = () => {
    const json = JSON.stringify({ type: "doc", content: blocks });
    return json.length > MAX_CONTENT_BYTES || (maxBytes < Infinity && encoder.encode(json).length > maxBytes);
  };
  let truncated = false;
  while (blocks.length > 1 && tooBig()) {
    blocks.splice(Math.max(1, Math.floor(blocks.length * 0.9)));
    truncated = true;
  }
  return { content: blocks, truncated };
}

export function blocksToDoc(blocks: Block[], opts: BlocksToDocOptions = {}): BlocksToDocResult {
  const stats = { paragraphs: 0, headings: 0, tables: 0, images: 0, imagePlaceholders: 0 };
  const content: DocNode[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading": {
        const inl = inline(b.text.replace(/\s+/g, " ").trim());
        if (!inl.length) break;
        content.push({ type: "heading", attrs: { level: Math.max(1, Math.min(4, b.level)) }, content: inl });
        stats.headings++;
        break;
      }
      case "paragraph": {
        const p = paragraph(b.text);
        if (!p.content) break;
        content.push(p);
        stats.paragraphs++;
        break;
      }
      case "table": {
        if (b.caption) {
          content.push(paragraph(b.caption));
          stats.paragraphs++;
        }
        const node = table(b);
        if (node) {
          content.push(node);
          stats.tables++;
        }
        break;
      }
      case "image": {
        const src = opts.imageUrl?.(b) ?? null;
        if (src) {
          content.push({ type: "image", attrs: { src, alt: `그림 ${b.n}`, title: null } });
          stats.images++;
        } else {
          content.push({ type: "paragraph", content: [{ type: "text", text: imagePlaceholderText(b.n), marks: [{ type: "italic" }] }] });
          stats.imagePlaceholders++;
        }
        break;
      }
    }
  }
  const fitted = fitToLimit(content, opts.maxBytes);
  return {
    doc: { type: "doc", content: fitted.content.length ? fitted.content : [{ type: "paragraph" }] },
    stats,
    truncated: fitted.truncated,
  };
}
