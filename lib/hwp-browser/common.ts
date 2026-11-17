import type { Block, HeadingBlock, ImageBlock, ParagraphBlock, ParseResult, ParseStats, TableBlock, TableCell } from "./types";

/** HWP·HWPX 공통: 문서를 모으는 상태와 블록 만들기 */

export const MAX_IMAGES = 200; // 파일 하나에서 꺼내는 그림 수
export const MAX_IMAGE_BYTES = 60 * 1024 * 1024; // 꺼내는 그림 크기 합

/** 읽는 동안 그림 자리 표시(나중에 실제 그림 블록으로 바꾸거나 뺀다) */
export type ImageRef = { type: "imageRef"; ref: number | string };
export type WorkBlock = HeadingBlock | ParagraphBlock | TableBlock | ImageBlock | ImageRef;

type Note = { n: number; text: string };

export type Ctx<Style, Shape> = {
  headingOf: (styleId: Style, shapeId: Shape) => number;
  footnotes: Note[];
  endnotes: Note[];
  /** 표 칸·각주처럼 글자로만 모으는 곳에서 나온 그림: 바깥 문단 뒤에 놓는다 */
  spill: WorkBlock[];
  stats: Omit<ParseStats, "footnotes" | "endnotes">;
};

/** headingOf를 뺀 공통 상태(구역 결과 정리·그림 처리에 쓴다) */
export type CtxBase = Omit<Ctx<never, never>, "headingOf">;

export function newCtx<Style, Shape>(headingOf: (styleId: Style, shapeId: Shape) => number): Ctx<Style, Shape> {
  return {
    headingOf,
    footnotes: [],
    endnotes: [],
    spill: [],
    stats: {
      pictures: 0,
      images: 0,
      imgMissing: 0,
      imgUnsupported: 0,
      imgUnsupportedKinds: [],
      imgLimit: 0,
      shapes: 0,
      textboxes: 0,
      equations: 0,
      headers: 0,
      comments: 0,
      multicol: false,
      partial: false,
      ole: 0,
    },
  };
}

/** U+F53A: 한컴 글꼴의 "한" 로고 글자(사용자 영역). 다른 글꼴에서는 네모로 보여 "한"으로 바꾼다. */
export const cleanText = (s: string) => s.replace(/\r/g, "").replace(//g, "한").replace(/[ \t ]+$/gm, "");

/** 문단 하나를 넣는다. 개요 수준이 있고 짧은 한 줄(문장 부호로 끝나지 않음)이면 제목으로. */
export function pushPara(out: WorkBlock[], text: string, heading: number) {
  const t = cleanText(text);
  if (!t.trim()) return;
  const one = t.trim();
  if (heading && one.length <= 80 && !/\n/.test(one) && !/[.!?。:;,]$/.test(one)) out.push({ type: "heading", level: Math.min(6, heading), text: one });
  else out.push({ type: "paragraph", text: t.replace(/^\n+|\n+$/g, "") });
}

export function tableText(t: TableBlock): string {
  const rows: string[][] = [];
  for (const c of t.cells) (rows[c.row] = rows[c.row] || []).push(c.text.replace(/\s*\n\s*/g, " "));
  return [t.caption || "", ...rows.filter(Boolean).map((r) => r.join(" "))].filter(Boolean).join("\n");
}

/** 블록 → 글자. 그림 블록은 글자가 없으므로 ctx.spill로 옮겨 바깥 문단 뒤에 놓이게 한다 */
export function flatten(blocks: WorkBlock[], ctx: { spill: WorkBlock[] }): string {
  return blocks
    .map((b) => {
      if (b.type === "image" || b.type === "imageRef") {
        ctx.spill.push(b);
        return "";
      }
      return b.type === "table" ? tableText(b) : b.text;
    })
    .filter(Boolean)
    .join("\n");
}

/** 셀 목록을 정리해 표 블록으로: 행·열 수는 실제 셀 주소로 다시 계산하고 병합 span을 범위 안으로 자른다 */
export function makeTable(declRows: number, declCols: number, input: TableCell[], caption: string): TableBlock {
  let rows = 0;
  let cols = 0;
  for (const c of input) {
    c.row = Math.max(0, c.row | 0);
    c.col = Math.max(0, c.col | 0);
    c.rowSpan = Math.max(1, c.rowSpan | 0);
    c.colSpan = Math.max(1, c.colSpan | 0);
    if (declRows > c.row) c.rowSpan = Math.min(c.rowSpan, declRows - c.row);
    if (declCols > c.col) c.colSpan = Math.min(c.colSpan, declCols - c.col);
    rows = Math.max(rows, c.row + c.rowSpan);
    cols = Math.max(cols, c.col + c.colSpan);
  }
  if (rows * cols > 200000) {
    // 비정상 주소: 병합을 버리고 범위를 줄인다
    for (const c of input) {
      c.rowSpan = 1;
      c.colSpan = 1;
    }
    rows = Math.min(rows, 2000);
    cols = Math.min(cols, 100);
  }
  const cells = input.filter((c) => c.row < rows && c.col < cols).sort((a, z) => a.row - z.row || a.col - z.col);
  return { type: "table", rows, cols, cells, caption: caption || "" };
}

/** 구역들을 이어 붙이고 각주·미주를 문서 끝에 모은 뒤 안내 문장을 만든다 */
export function finish(ctx: CtxBase, sections: Block[][]): ParseResult {
  const blocks: Block[] = ([] as Block[]).concat(...sections);
  const notes: string[] = [];
  if (ctx.footnotes.length) {
    blocks.push({ type: "heading", level: 2, text: "각주", extra: true });
    for (const f of ctx.footnotes) blocks.push({ type: "paragraph", text: `(${f.n}) ${f.text.trim()}`, note: true });
  }
  if (ctx.endnotes.length) {
    blocks.push({ type: "heading", level: 2, text: "미주", extra: true });
    for (const f of ctx.endnotes) blocks.push({ type: "paragraph", text: `(${f.n}) ${f.text.trim()}`, note: true });
  }
  const s = ctx.stats;
  if (s.partial) notes.push("파일 일부가 손상되어 읽을 수 있는 부분만 가져왔어요.");
  if (s.imgUnsupported) notes.push(`그림 ${s.imgUnsupported}개는 형식(${s.imgUnsupportedKinds.join(", ") || "알 수 없음"})을 지원하지 않아 가져오지 않았어요.`);
  if (s.imgMissing) notes.push(`그림 ${s.imgMissing}개는 파일 안에서 찾지 못해 가져오지 않았어요.`);
  if (s.imgLimit) notes.push(`그림 ${s.imgLimit}개는 한 파일에서 가져올 수 있는 양(${MAX_IMAGES}개, ${MAX_IMAGE_BYTES / 1024 / 1024}MB)을 넘어 건너뛰었어요.`);
  if (s.shapes + s.ole) notes.push(`도형·개체 ${s.shapes + s.ole}개는 가져오지 않았어요.`);
  if (s.textboxes) notes.push(`글상자 ${s.textboxes}개의 글자는 그 자리 아래에 문단으로 넣었어요.`);
  if (s.equations) notes.push(`수식 ${s.equations}개는 "[수식: …]" 글자로 넣었어요.`);
  if (ctx.footnotes.length || ctx.endnotes.length) notes.push(`각주·미주 ${ctx.footnotes.length + ctx.endnotes.length}개는 문서 끝에 모았어요.`);
  if (s.headers) notes.push(`머리말·꼬리말 ${s.headers}개는 건너뛰었어요.`);
  if (s.comments) notes.push(`숨은 설명 ${s.comments}개는 건너뛰었어요.`);
  if (s.multicol) notes.push("여러 단은 한 단으로 이어 붙였어요.");
  return { blocks, notes, stats: { ...s, imgUnsupportedKinds: [...s.imgUnsupportedKinds], footnotes: ctx.footnotes.length, endnotes: ctx.endnotes.length } };
}

/** 스타일 이름 "개요 N" / 영문 "Outline N" → 개요 수준(아니면 0) */
export function headingFromStyle(name: string | null | undefined, eng: string | null | undefined): number {
  const m = /^개요\s*(\d{1,2})$/.exec(String(name || "").trim()) || /^outline\s*(\d{1,2})$/i.exec(String(eng || "").trim());
  return m ? Number(m[1]) : 0;
}
