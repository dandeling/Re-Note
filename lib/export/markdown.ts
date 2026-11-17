import type { DocContent, DocNode } from "@/lib/editor/content";
import { nodeText } from "@/lib/export/html";
import { computeNumbering, numberLabel, type Numbering } from "@/lib/format/numbering";

/**
 * 문서 JSON → Markdown (GFM 표). 순수 함수.
 * 캡션·상호 참조 번호는 문서 순서로 계산해 넣고, 수식은 `$…$` / `$$…$$`로 쓴다.
 * 모르는 노드도 버리지 않고 텍스트로 내보낸다.
 */
const escapeText = (s: string) => s.replace(/([\\`*_[\]<>#|])/g, "\\$1");

function wrap(text: string, mark: { type: string; attrs?: Record<string, unknown> }): string {
  if (!text.trim()) return text;
  switch (mark.type) {
    case "bold":
      return `**${text}**`;
    case "italic":
      return `*${text}*`;
    case "strike":
      return `~~${text}~~`;
    case "code":
      return `\`${text}\``;
    case "link": {
      const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
      return /^(https?:|mailto:)/i.test(href) ? `[${text}](${href.replace(/[()\s]/g, encodeURIComponent)})` : text;
    }
    default:
      return text;
  }
}

function inline(nodes: DocNode[] | undefined, ctx: Numbering): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === "text") {
        const isCode = node.marks?.some((m) => m.type === "code");
        let text = isCode ? (node.text ?? "") : escapeText(node.text ?? "");
        for (const mark of node.marks ?? []) text = wrap(text, mark);
        return text;
      }
      if (node.type === "hardBreak") return "  \n";
      if (node.type === "mathInline") return `$${nodeText(node)}$`;
      if (node.type === "crossRef") {
        const target = node.attrs?.targetId;
        const n = typeof target === "string" ? ctx.byId.get(target) : undefined;
        return n ? numberLabel(n) : "??";
      }
      if (node.type === "image") return image(node);
      return node.content ? inline(node.content, ctx) : escapeText(nodeText(node));
    })
    .join("");
}

function image(node: DocNode): string {
  const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
  const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
  return `![${escapeText(alt)}](${src.replace(/[()\s]/g, encodeURIComponent)})`;
}

const indent = (text: string, by: string) =>
  text
    .split("\n")
    .map((line, i) => (i === 0 || line === "" ? line : by + line))
    .join("\n");

function cellText(cell: DocNode, ctx: Numbering): string {
  return (cell.content ?? [])
    .map((b) => (b.content ? inline(b.content, ctx) : escapeText(nodeText(b))))
    .join(" ")
    .replace(/\n/g, " ")
    .trim();
}

function table(node: DocNode, ctx: Numbering): string {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map((cell) => cellText(cell, ctx)));
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
  return [line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

function block(node: DocNode, ctx: Numbering): string {
  switch (node.type) {
    case "paragraph":
      return inline(node.content, ctx);
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `${"#".repeat(level)} ${inline(node.content, ctx)}`;
    }
    case "bulletList":
    case "orderedList": {
      const start = Number(node.attrs?.start ?? 1) || 1;
      return (node.content ?? [])
        .map((item, i) => {
          const marker = node.type === "bulletList" ? "- " : `${start + i}. `;
          return marker + indent(blocks(item.content, ctx), " ".repeat(marker.length));
        })
        .join("\n");
    }
    case "blockquote":
      return blocks(node.content, ctx)
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    case "codeBlock": {
      const lang = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      return `\`\`\`${lang}\n${nodeText(node)}\n\`\`\``;
    }
    case "horizontalRule":
      return "---";
    case "image":
      return image(node);
    case "table":
      return table(node, ctx);
    case "caption": {
      const n = ctx.byNode.get(node);
      const label = n ? (n.kind === "equation" ? numberLabel(n) : `${numberLabel(n)}.`) : "";
      return `*${label ? `${label} ` : ""}${inline(node.content, ctx)}*`;
    }
    case "mathBlock": {
      const n = ctx.byNode.get(node);
      return `$$\n${nodeText(node)}\n$$${n ? ` (${n.number})` : ""}`;
    }
    default:
      // 모르는 노드: 자식이 블록이면 블록으로, 아니면 텍스트로
      if (node.content?.some((c) => c.type !== "text" && c.content)) return blocks(node.content, ctx);
      return node.content ? inline(node.content, ctx) : escapeText(nodeText(node));
  }
}

function blocks(nodes: DocNode[] | undefined, ctx: Numbering): string {
  return (nodes ?? [])
    .map((n) => block(n, ctx))
    .filter((s) => s !== "")
    .join("\n\n");
}

export function documentToMarkdown(doc: DocContent): string {
  const ctx = computeNumbering(doc);
  return `${blocks(doc.content, ctx).trim()}\n`;
}
