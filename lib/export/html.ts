import { getSchema, type Extensions } from "@tiptap/core";
import { renderToHTMLString, serializeChildrenToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import katex from "katex";
import sanitizeHtml from "sanitize-html";
import type { DocContent, DocNode } from "@/lib/editor/content";
import { documentExtensions } from "@/lib/editor/extensions";
import { FORMAT_CSS, formatDataAttrs, formatPageCss, formatStyleAttr } from "@/lib/format/css";
import { captionKindOf, computeNumbering, numberLabel, type Numbering } from "@/lib/format/numbering";
import type { FormatRules } from "@/lib/format/rules";

/**
 * 내보내기용 HTML (SPEC 7.5 내보내기, P2-7).
 * 문서 JSON → HTML은 에디터와 같은 스키마(`documentExtensions()`)로 만든다.
 * 스키마가 모르는 노드(다른 브랜치의 캡션·수식 등)도 조용히 버리지 않고 최소한 텍스트로 내보낸다.
 * 결과는 항상 sanitize한다.
 */

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** 노드의 순수 텍스트 (atom 노드는 대표 속성을 텍스트로) */
export function nodeText(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (!node.content?.length) {
    const a = node.attrs ?? {};
    for (const key of ["latex", "text", "label", "alt", "title"]) {
      if (typeof a[key] === "string" && a[key]) return a[key] as string;
    }
    return "";
  }
  return node.content.map(nodeText).join("");
}

/** 캡션 번호를 문서 순서(렌더러가 방문하는 순서)대로 꺼내 쓰기 위한 목록 */
function captionLabels(doc: DocNode, numbering: Numbering): string[] {
  const labels: string[] = [];
  const visit = (node: DocNode) => {
    if (node.type === "caption") {
      const n = numbering.byNode.get(node);
      labels.push(n ? numberLabel(n) : "");
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  return labels;
}

type PmLike = { type: { name: string }; attrs: Record<string, unknown>; isInline?: boolean; textContent?: string };

type RenderProps = { node: PmLike; children?: unknown };

function renderCaption(props: RenderProps, label: string): string {
  const kind = captionKindOf({ type: "caption", attrs: props.node.attrs }) ?? "figure";
  const id = typeof props.node.attrs.id === "string" ? props.node.attrs.id : "";
  const body = serializeChildrenToHTMLString(props.children as never);
  const labelHtml = label ? `<span class="caption-label">${escape(kind === "equation" ? label : `${label}.`)}</span> ` : "";
  return `<p data-type="caption" data-kind="${escape(kind)}"${id ? ` id="${escape(id)}"` : ""}>${labelHtml}${body}</p>`;
}

function renderCrossRef(props: RenderProps, numbering: Numbering): string {
  const target = props.node.attrs.targetId;
  const n = typeof target === "string" ? numbering.byId.get(target) : undefined;
  return `<span data-type="crossRef">${escape(n ? numberLabel(n) : "??")}</span>`;
}

/** 스키마에 없는 노드: 블록이면 div, 인라인으로 보이면 span. 자식이 없으면 대표 속성을 텍스트로. */
function renderUnknown(props: RenderProps, original: DocNode, numbering: Numbering): string {
  const children = serializeChildrenToHTMLString(props.children as never);
  const type = escape(props.node.type.name);
  if (props.node.type.name === "mathInline") return `<span data-type="${type}">$${escape(nodeText(original))}$</span>`;
  if (props.node.type.name === "mathBlock") {
    const id = original.attrs?.id;
    const n = typeof id === "string" ? numbering.byId.get(id) : undefined;
    const label = n ? ` <span class="math-label">(${n.number})</span>` : "";
    return `<div data-type="${type}">$$${escape(nodeText(original))}$$${label}</div>`;
  }
  const text = children || escape(nodeText(original));
  return INLINE_HINT.test(props.node.type.name) ? `<span data-type="${type}">${text}</span>` : `<div data-type="${type}">${text}</div>`;
}
const INLINE_HINT = /inline|mention|ref|emoji|footnoteRef/i;

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code", "strong", "b", "em", "i", "s",
    "u", "mark", "sub", "sup", "a", "img", "table", "thead", "tbody", "tr", "td", "th", "colgroup", "col", "hr", "br",
    "span", "div", "figure", "figcaption",
  ],
  allowedAttributes: {
    "*": ["style", "class", "id", "data-*"],
    a: ["href", "title"],
    img: ["src", "alt", "title", "width", "height"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
    col: ["span"],
    ol: ["start", "type"],
  },
  allowedStyles: {
    "*": {
      "text-align": [/^(left|right|center|justify)$/],
      "min-width": [/^\d+(\.\d+)?(px|pt|mm|%)$/],
      width: [/^\d+(\.\d+)?(px|pt|mm|%)$/],
    },
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["data", "http", "https"] },
  allowProtocolRelative: false,
};

export function sanitizeDocumentHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE);
}

const decodeAttr = (v: string) =>
  v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const MATH_PLACEHOLDER = /<(span|div) data-math="(inline|block)" data-latex="([^"]*)"(?: data-number="(\d+)")?><\/\1>/g;

/** 수식 자리표시자(sanitize를 통과한 뒤)를 KaTeX MathML로 바꾼다. Chromium은 MathML을 그대로 인쇄한다. */
function renderMathPlaceholders(html: string): string {
  return html.replace(MATH_PLACEHOLDER, (_all, _tag: string, mode: string, rawLatex: string, number?: string) => {
    const latex = decodeAttr(rawLatex);
    const block = mode === "block";
    let body: string;
    try {
      body = katex.renderToString(latex, { output: "mathml", displayMode: block, throwOnError: true });
    } catch {
      // 잘못된 LaTeX는 원문을 그대로 보여 준다.
      body = escape(block ? `$$${latex}$$` : `$${latex}$`);
    }
    if (!block) return `<span data-type="mathInline" class="doc-math-inline">${body}</span>`;
    const label = number ? ` <span class="math-label">(${number})</span>` : "";
    return `<div data-type="mathBlock" class="doc-math-block">${body}${label}</div>`;
  });
}

function mathPlaceholder(node: PmLike, numbering: Numbering): string {
  const latex = typeof node.attrs.latex === "string" ? node.attrs.latex : "";
  if (node.type.name === "mathInline") return `<span data-math="inline" data-latex="${escape(latex)}"></span>`;
  const id = node.attrs.id;
  const n = typeof id === "string" ? numbering.byId.get(id) : undefined;
  return `<div data-math="block" data-latex="${escape(latex)}"${n ? ` data-number="${n.number}"` : ""}></div>`;
}

export function documentBodyHtml(doc: DocContent, extensions: Extensions = documentExtensions()): string {
  const numbering = computeNumbering(doc);
  const labels = captionLabels(doc, numbering);
  let captionIndex = 0;
  const caption = (props: RenderProps) => renderCaption(props, labels[captionIndex++] ?? "");
  const crossRef = (props: RenderProps) => renderCrossRef(props, numbering);
  const schema = getSchema(extensions);

  const html = renderToHTMLString({
    content: doc,
    extensions,
    options: {
      // 캡션 번호·상호 참조 번호는 저장하지 않으므로 여기서 문서 순서로 채운다.
      nodeMapping: {
        ...(schema.nodes.caption ? { caption } : {}),
        ...(schema.nodes.crossRef ? { crossRef } : {}),
        ...(schema.nodes.mathInline ? { mathInline: (props: RenderProps) => mathPlaceholder(props.node, numbering) } : {}),
        ...(schema.nodes.mathBlock ? { mathBlock: (props: RenderProps) => mathPlaceholder(props.node, numbering) } : {}),
      },
      unhandledNode: (props: RenderProps & { node: PmLike & { toJSON(): DocNode } }) => {
        const name = props.node.type.name;
        if (name === "caption") return caption(props);
        if (name === "crossRef") return crossRef(props);
        return renderUnknown(props, props.node.toJSON(), numbering);
      },
      unhandledMark: ({ children }: { children?: unknown }) => serializeChildrenToHTMLString(children as never),
    },
  } as Parameters<typeof renderToHTMLString>[0]);
  return renderMathPlaceholders(sanitizeDocumentHtml(html));
}

/** 인쇄용 기본 스타일 (에디터의 `.doc-content` 스타일 중 내용에 해당하는 것) */
const PRINT_BASE_CSS = `
.doc-content ul { list-style: disc; padding-left: 1.5em; }
.doc-content ol { list-style: decimal; padding-left: 1.5em; }
.doc-content blockquote { border-left: 3px solid #d4d4d8; padding-left: 1em; color: #52525b; margin-left: 0; }
.doc-content code { background: #f4f4f5; border-radius: 3px; padding: 0.1em 0.3em; font-size: 0.9em; }
.doc-content pre { background: #f4f4f5; border-radius: 4px; padding: 0.6em 0.8em; white-space: pre-wrap; }
.doc-content pre code { background: none; padding: 0; }
.doc-content hr { border: 0; border-top: 1px solid #d4d4d8; margin: 1em 0; }
.doc-content img { max-width: 100%; height: auto; display: block; margin-inline: auto; }
.doc-content table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.doc-content th, .doc-content td { border: 1px solid #71717a; padding: 0.3em 0.5em; vertical-align: top; }
.doc-content th { background: #f4f4f5; }
.doc-content h1, .doc-content h2, .doc-content h3, .doc-content h4 { break-after: avoid; }
.doc-content tr, .doc-content img { break-inside: avoid; }
`;

/**
 * 인쇄(PDF)용 완성 HTML 문서. 에디터와 같은 서식 변수·스타일시트(FORMAT_CSS)에 용지·여백·쪽 번호(@page)를 더한다.
 * `fontCss`에는 규칙이 쓰는 글꼴의 @font-face를 넣는다.
 */
export function exportHtmlDocument(opts: { doc: DocContent; rules: FormatRules; title: string; fontCss?: string }): string {
  const attrs = Object.entries(formatDataAttrs(opts.rules))
    .map(([k, v]) => ` ${k}="${escape(v)}"`)
    .join("");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${escape(opts.title)}</title>
<style>
${opts.fontCss ?? ""}
${formatPageCss(opts.rules)}
${PRINT_BASE_CSS}
${FORMAT_CSS}
</style>
</head>
<body>
<div class="doc-format doc-content" style="${escape(formatStyleAttr(opts.rules))}"${attrs}>
<div class="tiptap">
${documentBodyHtml(opts.doc)}
</div>
</div>
</body>
</html>`;
}
