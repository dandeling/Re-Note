import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import type { DocContent, DocNode } from "@/lib/editor/content";

/**
 * 중간 형식 HTML(Markdown·DOCX·HWP·PDF에서 만든 것) → Tiptap 문서 JSON.
 *
 * 허용 목록 방식이다: 기본 노드(heading, paragraph, bulletList, orderedList, listItem, table, tableRow,
 * tableHeader, tableCell, image, blockquote, codeBlock, hardBreak)와 마크(bold, italic, strike, code, link)만
 * 만든다. 나머지 태그는 내용만 남기고 벗기며, script·style 등은 내용째 버린다. 그래서 이 함수의 결과는
 * 원본 HTML이 무엇이든 안전하다.
 */

type Node = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;
type Mark = NonNullable<DocNode["marks"]>[number];

export type ImportStats = { paragraphs: number; headings: number; tables: number; images: number };

export type HtmlToDocOptions = {
  /** img의 src를 문서에 넣을 URL로 바꾼다. null이면 그 그림은 버린다. 없으면 그림을 모두 버린다. */
  imageUrl?: (src: string) => string | null;
};

export type HtmlToDocResult = { doc: DocContent; stats: ImportStats; droppedImages: number };

const DROP = new Set(["script", "style", "noscript", "template", "iframe", "object", "embed", "head", "title", "meta", "link", "svg", "math", "button", "select", "textarea", "input", "form"]);
const HEADING = /^h([1-6])$/;
const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "blockquote", "pre", "img", "hr", "div", "section", "article", "main", "header", "footer", "aside", "nav", "figure", "figcaption", "body", "html", "li", "dl", "dt", "dd", "address", "center"]);

const isElement = (node: Node): node is Element => "tagName" in node;
const attr = (el: Element, name: string) => el.attrs.find((a) => a.name === name)?.value;

/** 링크는 http(s)·mailto와 문서 안 앵커만 허용 */
function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  const value = href.trim();
  if (/^(https?:|mailto:)/i.test(value)) return value;
  return null;
}

function normalizeSpace(text: string) {
  return text.replace(/[\t\n\r\f ]+/g, " ");
}

/** 인라인 노드 배열의 앞뒤 공백 정리와 인접 텍스트 병합 */
function tidyInline(nodes: DocNode[]): DocNode[] {
  const merged: DocNode[] = [];
  for (const node of nodes) {
    const prev = merged.at(-1);
    if (node.type === "text" && prev?.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(node.marks ?? [])) {
      prev.text = (prev.text ?? "") + (node.text ?? "");
    } else merged.push({ ...node });
  }
  // 앞뒤 공백 제거
  while (merged[0]?.type === "hardBreak") merged.shift();
  while (merged.at(-1)?.type === "hardBreak") merged.pop();
  const first = merged[0];
  if (first?.type === "text") first.text = first.text!.replace(/^\s+/, "");
  const last = merged.at(-1);
  if (last?.type === "text") last.text = last.text!.replace(/\s+$/, "");
  return merged.filter((node) => node.type !== "text" || (node.text ?? "").length > 0);
}

class Converter {
  stats: ImportStats = { paragraphs: 0, headings: 0, tables: 0, images: 0 };
  droppedImages = 0;
  constructor(private readonly opts: HtmlToDocOptions) {}

  /** 블록 문맥의 자식들을 블록 노드 배열로 바꾼다. 흩어진 인라인 내용은 문단으로 묶는다. */
  blocks(children: Node[]): DocNode[] {
    const out: DocNode[] = [];
    let pending: Node[] = [];
    const flush = () => {
      if (pending.length === 0) return;
      out.push(...this.paragraph(pending));
      pending = [];
    };
    for (const child of children) {
      if (isElement(child) && (BLOCK_TAGS.has(child.tagName) || DROP.has(child.tagName))) {
        flush();
        out.push(...this.block(child));
      } else if (isElement(child) && this.containsBlock(child)) {
        // <span><p>..</p></span> 같은 잘못된 중첩: 블록으로 다룬다
        flush();
        out.push(...this.blocks(child.childNodes));
      } else {
        pending.push(child);
      }
    }
    flush();
    return out;
  }

  private containsBlock(el: Element): boolean {
    return el.childNodes.some((c) => isElement(c) && (BLOCK_TAGS.has(c.tagName) || this.containsBlock(c)));
  }

  private block(el: Element): DocNode[] {
    const tag = el.tagName;
    if (DROP.has(tag) || tag === "hr") return [];
    const heading = HEADING.exec(tag);
    if (heading) {
      const { inline, images } = this.inlineWithImages(el.childNodes);
      const nodes: DocNode[] = [];
      if (inline.length) {
        this.stats.headings += 1;
        nodes.push({ type: "heading", attrs: { level: Math.min(4, Number(heading[1])) }, content: inline });
      }
      return [...nodes, ...images];
    }
    switch (tag) {
      case "p":
      case "dt":
      case "dd":
      case "figcaption":
      case "address":
        return this.paragraph(el.childNodes);
      case "ul":
      case "ol":
        return this.list(el);
      case "li":
        return this.blocks(el.childNodes);
      case "table":
        return this.table(el);
      case "blockquote": {
        const content = this.blocks(el.childNodes);
        return content.length ? [{ type: "blockquote", content }] : [];
      }
      case "pre": {
        const code = el.childNodes.find((c): c is Element => isElement(c) && c.tagName === "code");
        const language = /language-([\w+-]+)/.exec(code ? (attr(code, "class") ?? "") : "")?.[1] ?? null;
        const text = this.rawText(el).replace(/\n$/, "");
        return [{ type: "codeBlock", attrs: { language }, ...(text ? { content: [{ type: "text", text }] } : {}) }];
      }
      case "img":
        return this.image(el);
      default:
        return this.blocks(el.childNodes);
    }
  }

  /** 문단. 안에 든 그림은 문단 뒤의 별도 블록으로 뺀다 (image는 블록 노드). */
  private paragraph(children: Node[]): DocNode[] {
    const { inline, images } = this.inlineWithImages(children);
    const out: DocNode[] = [];
    if (inline.length) {
      this.stats.paragraphs += 1;
      out.push({ type: "paragraph", content: inline });
    }
    return [...out, ...images];
  }

  private inlineWithImages(children: Node[]) {
    const images: DocNode[] = [];
    const inline = tidyInline(this.inline(children, [], images));
    return { inline, images };
  }

  private inline(children: Node[], marks: Mark[], images: DocNode[]): DocNode[] {
    const out: DocNode[] = [];
    for (const child of children) {
      if (child.nodeName === "#text") {
        const text = normalizeSpace((child as DefaultTreeAdapterTypes.TextNode).value);
        if (text) out.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
        continue;
      }
      if (!isElement(child) || DROP.has(child.tagName)) continue;
      const tag = child.tagName;
      if (tag === "br") {
        out.push({ type: "hardBreak" });
        continue;
      }
      if (tag === "img") {
        images.push(...this.image(child));
        continue;
      }
      const mark = this.markFor(child);
      const next = mark && !marks.some((m) => m.type === mark.type) ? [...marks, mark] : marks;
      // 코드 마크는 다른 마크와 함께 쓰지 않는다 (Tiptap code 마크는 excludes: "_")
      out.push(...this.inline(child.childNodes, mark?.type === "code" ? [mark] : next, images));
      if (BLOCK_TAGS.has(tag) || tag === "li") out.push({ type: "text", text: " " });
    }
    return out;
  }

  private markFor(el: Element): Mark | null {
    switch (el.tagName) {
      case "b":
      case "strong":
        return { type: "bold" };
      case "i":
      case "em":
        return { type: "italic" };
      case "s":
      case "del":
      case "strike":
        return { type: "strike" };
      case "code":
      case "kbd":
      case "samp":
        return { type: "code" };
      case "a": {
        const href = safeHref(attr(el, "href"));
        return href ? { type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow", class: null, title: null } } : null;
      }
      default:
        return null;
    }
  }

  private image(el: Element): DocNode[] {
    const src = attr(el, "src");
    const url = src && this.opts.imageUrl ? this.opts.imageUrl(src) : null;
    if (!url) {
      this.droppedImages += 1;
      return [];
    }
    this.stats.images += 1;
    const alt = attr(el, "alt")?.slice(0, 500) || null;
    return [{ type: "image", attrs: { src: url, alt, title: null } }];
  }

  private list(el: Element): DocNode[] {
    const items: DocNode[] = [];
    let stray: Node[] = [];
    const pushItem = (children: Node[]) => {
      const content = this.blocks(children);
      // listItem의 첫 자식은 문단이어야 한다
      if (content.length === 0 || content[0].type !== "paragraph") content.unshift({ type: "paragraph" });
      items.push({ type: "listItem", content });
    };
    for (const child of el.childNodes) {
      if (isElement(child) && child.tagName === "li") {
        if (stray.length) pushItem(stray);
        stray = [];
        pushItem(child.childNodes);
      } else if (isElement(child) && (child.tagName === "ul" || child.tagName === "ol") && items.length) {
        // <ul><li>a</li><ul>..</ul></ul> 처럼 li 밖에 놓인 하위 목록은 앞 항목에 붙인다
        items.at(-1)!.content!.push(...this.list(child));
      } else if (child.nodeName !== "#text" || (child as DefaultTreeAdapterTypes.TextNode).value.trim()) {
        stray.push(child);
      }
    }
    if (stray.length) pushItem(stray);
    if (!items.length) return [];
    if (el.tagName === "ol") {
      const start = Number(attr(el, "start"));
      return [{ type: "orderedList", attrs: { start: Number.isInteger(start) && start > 0 ? start : 1, type: null }, content: items }];
    }
    return [{ type: "bulletList", content: items }];
  }

  private table(el: Element): DocNode[] {
    const rows: Element[] = [];
    const collect = (node: Element) => {
      for (const child of node.childNodes) {
        if (!isElement(child)) continue;
        if (child.tagName === "tr") rows.push(child);
        else if (["thead", "tbody", "tfoot"].includes(child.tagName)) collect(child);
      }
    };
    collect(el);
    const caption = el.childNodes.find((c): c is Element => isElement(c) && c.tagName === "caption");
    const before = caption ? this.paragraph(caption.childNodes) : [];

    const tableRows: DocNode[] = [];
    for (const row of rows) {
      const cells: DocNode[] = [];
      for (const cell of row.childNodes) {
        if (!isElement(cell) || (cell.tagName !== "td" && cell.tagName !== "th")) continue;
        const content = this.blocks(cell.childNodes).filter((n) => n.type !== "table");
        const colspan = Math.min(50, Math.max(1, Number(attr(cell, "colspan")) || 1));
        const rowspan = Math.min(500, Math.max(1, Number(attr(cell, "rowspan")) || 1));
        cells.push({
          type: cell.tagName === "th" ? "tableHeader" : "tableCell",
          attrs: { colspan, rowspan, colwidth: null },
          content: content.length ? content : [{ type: "paragraph" }],
        });
      }
      if (cells.length) tableRows.push({ type: "tableRow", content: cells });
    }
    if (!tableRows.length) return before;
    this.stats.tables += 1;
    return [...before, { type: "table", content: tableRows }];
  }

  private rawText(node: Node): string {
    if (node.nodeName === "#text") return (node as DefaultTreeAdapterTypes.TextNode).value;
    if (!isElement(node)) return "";
    if (node.tagName === "br") return "\n";
    return node.childNodes.map((c) => this.rawText(c)).join("");
  }
}

/** 이미지 src 목록 (중복 제거). 그림을 자산으로 올린 뒤 imageUrl로 바꿔 넣을 때 쓴다. */
export function collectImageSources(html: string): string[] {
  const found = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      if (node.tagName === "img") {
        const src = attr(node, "src");
        if (src) found.add(src);
      }
      walk(node.childNodes);
    }
  };
  walk(parseFragment(html).childNodes);
  return [...found];
}

export function htmlToDoc(html: string, opts: HtmlToDocOptions = {}): HtmlToDocResult {
  const converter = new Converter(opts);
  const content = converter.blocks(parseFragment(html).childNodes);
  return {
    doc: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] },
    stats: converter.stats,
    droppedImages: converter.droppedImages,
  };
}
