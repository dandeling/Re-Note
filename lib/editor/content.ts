import { z } from "zod";

export type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

export type DocContent = DocNode & { type: "doc" };

/** 저장 가능한 문서 JSON의 최대 크기 (직렬화 기준) */
export const MAX_CONTENT_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 40;

const markSchema = z.object({ type: z.string().min(1).max(50), attrs: z.record(z.string(), z.unknown()).optional() });

const nodeSchema: z.ZodType<DocNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(50),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(nodeSchema).optional(),
    marks: z.array(markSchema).optional(),
    text: z.string().optional(),
  }),
);

function depth(node: DocNode, level = 1): number {
  if (level > MAX_DEPTH) return level;
  let max = level;
  for (const child of node.content ?? []) max = Math.max(max, depth(child, level + 1));
  return max;
}

/** Tiptap(ProseMirror) 문서 JSON 검증 스키마 */
export const docContentSchema = z
  .object({ type: z.literal("doc"), content: z.array(nodeSchema).optional() })
  .refine((doc) => depth(doc as DocNode) <= MAX_DEPTH, { message: "문서 구조가 너무 깊습니다." })
  .refine((doc) => JSON.stringify(doc).length <= MAX_CONTENT_BYTES, { message: "문서가 너무 큽니다." }) as z.ZodType<DocContent>;

export const EMPTY_DOC: DocContent = { type: "doc", content: [{ type: "paragraph" }] };

/** 문서의 순수 텍스트 (검색·미리보기·테스트용) */
export function docToText(node: DocNode): string {
  if (node.text) return node.text;
  const parts = (node.content ?? []).map(docToText);
  return node.type === "doc" || parts.length > 1 ? parts.join(node.type === "doc" ? "\n" : "") : parts.join("");
}
