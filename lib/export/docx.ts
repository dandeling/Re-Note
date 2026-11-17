import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import type { DocContent, DocNode } from "@/lib/editor/content";
import { nodeText } from "@/lib/export/html";
import { FONTS, type FontId } from "@/lib/format/fonts";
import { appName } from "@/lib/messages";
import { computeNumbering, numberLabel, type Numbering } from "@/lib/format/numbering";
import { PAPER_SIZES, pageDimensions, type FormatRules } from "@/lib/format/rules";

/**
 * 문서 JSON → DOCX (라이브러리: docx, docs/decisions.md format-1).
 * 서식 규칙(용지·여백·글꼴·크기·줄 간격·들여쓰기·제목·캡션·쪽 번호)을 Word 스타일과 문단 속성으로 옮긴다.
 * 글꼴은 이름만 지정한다(OFL 글꼴이지만 Word 파일에 넣지는 않는다). 모르는 노드는 텍스트로 내보낸다.
 */
const twip = (mm: number) => Math.round((mm * 1440) / 25.4);
const halfPt = (pt: number) => Math.round(pt * 2);
const ptTwip = (pt: number) => Math.round(pt * 20);
const fontOf = (id: FontId) => {
  const name = FONTS[id].family;
  return { ascii: name, eastAsia: name, hAnsi: name, cs: name };
};
const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];

type Ctx = {
  rules: FormatRules;
  numbering: Numbering;
  /** 본문 폭 (px, 96dpi) — 그림을 이 폭에 맞춘다 */
  contentWidthPx: number;
  orderedInstance: number;
};

/** PNG/JPEG/GIF 크기 (px). 모르면 null */
export function imageSize(data: Buffer): { width: number; height: number; type: "png" | "jpg" | "gif" } | null {
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) {
    return { type: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length > 10 && data.toString("ascii", 0, 3) === "GIF") {
    return { type: "gif", width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return null;
      const marker = data[i + 1];
      const len = data.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: "jpg", height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

function imageRun(node: DocNode, ctx: Ctx): ParagraphChild {
  const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
  const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
  const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(src);
  const data = m ? Buffer.from(m[1], "base64") : null;
  const size = data ? imageSize(data) : null;
  if (!data || !size || size.width === 0 || size.height === 0) {
    // 외부 주소 그림은 서버에서 내려받지 않는다(SSRF 방지). 대체 텍스트를 남긴다.
    return new TextRun({ text: `[${alt || src}]` });
  }
  const scale = Math.min(1, ctx.contentWidthPx / size.width);
  return new ImageRun({
    type: size.type,
    data,
    transformation: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) },
    altText: alt ? { name: alt, description: alt, title: alt } : undefined,
  });
}

function runs(nodes: DocNode[] | undefined, ctx: Ctx, base: IRunOptions = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "text") {
      const marks = new Set((node.marks ?? []).map((m) => m.type));
      const run: IRunOptions = {
        ...base,
        text: node.text ?? "",
        ...(marks.has("bold") ? { bold: true } : {}),
        ...(marks.has("italic") ? { italics: true } : {}),
        ...(marks.has("strike") ? { strike: true } : {}),
        ...(marks.has("underline") ? { underline: {} } : {}),
        ...(marks.has("code") ? { font: "Consolas" } : {}),
      };
      const link = node.marks?.find((m) => m.type === "link")?.attrs?.href;
      if (typeof link === "string" && /^(https?:|mailto:)/i.test(link)) {
        out.push(new ExternalHyperlink({ link, children: [new TextRun({ ...run, style: "Hyperlink" })] }));
      } else out.push(new TextRun(run));
      continue;
    }
    if (node.type === "hardBreak") out.push(new TextRun({ ...base, break: 1 }));
    else if (node.type === "image") out.push(imageRun(node, ctx));
    else if (node.type === "crossRef") {
      const target = node.attrs?.targetId;
      const n = typeof target === "string" ? ctx.numbering.byId.get(target) : undefined;
      out.push(new TextRun({ ...base, text: n ? numberLabel(n) : "??" }));
    } else if (node.content) out.push(...runs(node.content, ctx, base));
    else {
      const text = nodeText(node);
      if (text) out.push(new TextRun({ ...base, text }));
    }
  }
  return out;
}

function paragraph(node: DocNode, ctx: Ctx, extra: IParagraphOptions = {}): Paragraph {
  const align = node.attrs?.textAlign;
  return new Paragraph({
    ...(typeof align === "string" && align in ALIGN ? { alignment: ALIGN[align as keyof typeof ALIGN] } : {}),
    ...extra,
    children: runs(node.content, ctx),
  });
}

function blocks(nodes: DocNode[] | undefined, ctx: Ctx, list?: { reference: string; level: number; instance: number }): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const node of nodes ?? []) out.push(...block(node, ctx, list));
  return out;
}

function block(node: DocNode, ctx: Ctx, list?: { reference: string; level: number; instance: number }): (Paragraph | Table)[] {
  const { rules } = ctx;
  switch (node.type) {
    case "paragraph":
      return [paragraph(node, ctx, list ? { numbering: list, indent: { firstLine: 0 } } : {})];
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 4);
      return [paragraph(node, ctx, { heading: HEADINGS[level - 1] })];
    }
    case "bulletList":
    case "orderedList": {
      const level = list ? Math.min(list.level + 1, 8) : 0;
      const reference = node.type === "bulletList" ? "bullets" : "numbers";
      const instance = node.type === "orderedList" ? (ctx.orderedInstance += 1) : 0;
      return (node.content ?? []).flatMap((item) => {
        const [first, ...rest] = item.content ?? [];
        const head = first ? block(first, ctx, { reference, level, instance }) : [];
        return [...head, ...blocks(rest, ctx, { reference, level, instance })];
      });
    }
    case "blockquote":
      return blocks(node.content, ctx);
    case "codeBlock":
      return nodeText(node)
        .split("\n")
        .map((line) => new Paragraph({ indent: { firstLine: 0 }, children: [new TextRun({ text: line, font: "Consolas" })] }));
    case "horizontalRule":
      return [new Paragraph({ border: { bottom: { style: "single", size: 6, color: "999999", space: 1 } }, children: [] })];
    case "image":
      return [new Paragraph({ alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, children: [imageRun(node, ctx)] })];
    case "table": {
      const rows = (node.content ?? []).map(
        (row) =>
          new TableRow({
            children: (row.content ?? []).map(
              (cell) =>
                new TableCell({
                  columnSpan: Number(cell.attrs?.colspan ?? 1) || 1,
                  rowSpan: Number(cell.attrs?.rowspan ?? 1) || 1,
                  children: cell.content?.length ? blocks(cell.content, ctx) : [new Paragraph({ children: [] })],
                }),
            ),
          }),
      );
      return rows.length ? [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })] : [];
    }
    case "caption": {
      const n = ctx.numbering.byNode.get(node);
      const label = n ? (n.kind === "equation" ? numberLabel(n) : `${numberLabel(n)}.`) : "";
      const style: IRunOptions = { size: halfPt(rules.caption.sizePt), bold: rules.caption.bold };
      return [
        new Paragraph({
          alignment: ALIGN[rules.caption.align],
          indent: { firstLine: 0 },
          children: [...(label ? [new TextRun({ ...style, text: `${label} ` })] : []), ...runs(node.content, ctx, style)],
        }),
      ];
    }
    case "mathBlock": {
      const n = ctx.numbering.byNode.get(node);
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          indent: { firstLine: 0 },
          children: [new TextRun({ text: `${nodeText(node)}${n ? `    (${n.number})` : ""}`, font: "Cambria Math" })],
        }),
      ];
    }
    default:
      // 모르는 노드: 블록 자식이 있으면 블록으로, 아니면 텍스트 문단으로
      if (node.content?.some((c) => c.type !== "text" && c.content)) return blocks(node.content, ctx, list);
      return [new Paragraph({ children: node.content ? runs(node.content, ctx) : [new TextRun(nodeText(node))] })];
  }
}

function pageNumberParagraph(rules: FormatRules): Paragraph {
  const style = rules.pageNumber.style;
  const children =
    style === "total"
      ? [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES]
      : style === "dash"
        ? ["- ", PageNumber.CURRENT, " -"]
        : [PageNumber.CURRENT];
  return new Paragraph({
    alignment: rules.pageNumber.position.endsWith("right") ? AlignmentType.RIGHT : AlignmentType.CENTER,
    indent: { firstLine: 0 },
    children: [new TextRun({ children, size: 18 })],
  });
}

export async function documentToDocx(doc: DocContent, rules: FormatRules, title: string): Promise<Buffer> {
  const paper = PAPER_SIZES[rules.page.size];
  const m = rules.page.margin;
  const contentWidthMm = pageDimensions(rules).width - m.left - m.right;
  const ctx: Ctx = { rules, numbering: computeNumbering(doc), contentWidthPx: (contentWidthMm * 96) / 25.4, orderedInstance: 0 };
  const heading = (h: "h1" | "h2" | "h3" | "h4") => {
    const s = rules.headings[h];
    return {
      run: { font: fontOf(s.font), size: halfPt(s.sizePt), bold: s.bold, color: "000000" },
      paragraph: { alignment: ALIGN[s.align], spacing: { before: ptTwip(s.sizePt), after: ptTwip(s.sizePt / 2) }, indent: { firstLine: 0 } },
    };
  };
  const pageNumber = rules.pageNumber.enabled ? pageNumberParagraph(rules) : null;
  const top = rules.pageNumber.position.startsWith("top");

  const document = new Document({
    title,
    creator: appName,
    styles: {
      default: {
        document: {
          run: { font: fontOf(rules.body.font), size: halfPt(rules.body.sizePt) },
          paragraph: {
            alignment: ALIGN[rules.body.align],
            spacing: { line: Math.round((240 * rules.body.lineHeight) / 100), lineRule: LineRuleType.AUTO, after: ptTwip(rules.paragraph.spacingPt) },
            indent: { firstLine: ptTwip(rules.paragraph.indentPt) },
          },
        },
        heading1: heading("h1"),
        heading2: heading("h2"),
        heading3: heading("h3"),
        heading4: heading("h4"),
      },
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ["•", "◦", "▪"][level % 3],
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } },
          })),
        },
        {
          reference: "numbers",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: twip(paper.width),
              height: twip(paper.height),
              orientation: rules.page.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: { top: twip(m.top), right: twip(m.right), bottom: twip(m.bottom), left: twip(m.left) },
          },
        },
        ...(pageNumber
          ? top
            ? { headers: { default: new Header({ children: [pageNumber] }) } }
            : { footers: { default: new Footer({ children: [pageNumber] }) } }
          : {}),
        children: blocks(doc.content, ctx),
      },
    ],
  });
  return Packer.toBuffer(document);
}
