import { Editor } from "@tiptap/core";
import type { CaptionKind } from "@/lib/captions/types";
import type { DocContent, DocNode } from "@/lib/editor/content";
import { documentExtensions, type DocumentExtensionOptions } from "@/lib/editor/extensions";

// 문서 JSON 조각을 짧게 쓰기 위한 도우미
export const text = (value: string): DocNode => ({ type: "text", text: value });
export const p = (...content: (DocNode | string)[]): DocNode => ({
  type: "paragraph",
  ...(content.length ? { content: content.map((c) => (typeof c === "string" ? text(c) : c)) } : {}),
});
export const img = (src = "a.png"): DocNode => ({ type: "image", attrs: { src } });
export const cap = (kind: CaptionKind, id: string, value = ""): DocNode => ({
  type: "caption",
  attrs: { kind, id },
  ...(value ? { content: [text(value)] } : {}),
});
export const ref = (targetId: string): DocNode => ({ type: "crossRef", attrs: { targetId } });
export const mathBlock = (id: string, latex = "E=mc^2"): DocNode => ({ type: "mathBlock", attrs: { id, latex } });
export const mathInline = (latex: string): DocNode => ({ type: "mathInline", attrs: { latex } });
export const captionList = (kind: CaptionKind): DocNode => ({ type: "captionList", attrs: { kind } });
export const table = (): DocNode => ({
  type: "table",
  content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("셀")] }] }],
});
export const doc = (...content: DocNode[]): DocContent => ({ type: "doc", content });

/**
 * 화면 없이 도는 에디터. Tiptap은 화면에 붙기 전에는 플러그인을 등록하지 않으므로
 * (id 중복 제거, 캡션 정리 등) 직접 등록해 준다.
 */
export function headlessEditor(content: DocContent, options?: DocumentExtensionOptions): Editor {
  const editor = new Editor({ element: null, extensions: documentExtensions(options), content });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
}

/** attrs의 null 기본값 등을 떼고 노드 종류만 나열한다. */
export function shape(editor: Editor): string[] {
  return (editor.getJSON().content ?? []).map((node) => {
    if (node.type === "caption") return `caption:${node.attrs?.kind}:${node.attrs?.id}`;
    return node.type ?? "";
  });
}
